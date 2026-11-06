"""Loopback-only Ollama transport. Never downloads weights or calls a cloud API."""
import json
import logging
import re
import shutil
import copy

import httpx
from pydantic import ValidationError

from ..models.discovery import Assessment, Assessments
from .media import ProcessingError
from .media import check_cancel
from .discovery_strategies import get_system_prompt

logger = logging.getLogger(__name__)


def normalized(text):
    return ' '.join(re.findall(r'\w+', text.casefold()))


class Ollama:
    def __init__(self, settings):
        self.settings = settings

    def _client(self, timeout):
        # Ignore HTTP(S)_PROXY and do not follow redirects off the local service.
        return httpx.Client(base_url=self.settings.ollama_url, timeout=timeout, trust_env=False, follow_redirects=False)

    def status(self):
        result = {'status': 'unavailable', 'model': self.settings.ollama_model, 'url': self.settings.ollama_url,
                  'installed': bool(shutil.which('ollama')),
                  'message': f'Ollama is not reachable at {self.settings.ollama_url}. Start Ollama or run ollama serve.'}
        try:
            with self._client(2) as client:
                response = client.get('/api/tags')
                response.raise_for_status()
                models = response.json()['models']
                if not isinstance(models, list) or any(not isinstance(m, dict) for m in models):
                    raise ValueError('Invalid model list')
                match = next((model for model in models if model.get('name') == self.settings.ollama_model or model.get('model') == self.settings.ollama_model), None)
                if not match:
                    return {**result, 'installed': True, 'status': 'model_missing', 'message': f'Local model missing. Run: ollama pull {self.settings.ollama_model} (first-time setup needs internet).'}
                details = client.post('/api/show', json={'model': self.settings.ollama_model})
                details.raise_for_status()
                info = details.json()
                if not isinstance(info, dict) or not info:
                    raise ValueError('Invalid model details')
                if info.get('remote_model') or info.get('remote_host') or match.get('remote_model') or 'cloud' in self.settings.ollama_model.lower():
                    return {**result, 'installed': True, 'status': 'unsupported', 'message': 'Cloud-backed Ollama models are disabled. Install a fully local model.'}
                if 'capabilities' in info and 'completion' not in info['capabilities']:
                    return {**result, 'installed': True, 'status': 'unsupported', 'message': 'The configured local model does not support text generation.'}
                return {**result, 'installed': True, 'status': 'ready', 'message': f'Local model available: {self.settings.ollama_model}.', 'digest': match.get('digest', ''), 'capabilities': info.get('capabilities', [])}
        except httpx.TimeoutException:
            return {**result, 'status': 'timeout', 'message': f'Ollama health check timed out at {self.settings.ollama_url}. It may be busy; retry shortly.'}
        except httpx.HTTPStatusError as error:
            return {**result, 'status': 'invalid_response', 'message': f'Ollama health check returned HTTP {error.response.status_code}. Check the local service and configured model.'}
        except httpx.RequestError:
            return result
        except (ValueError, KeyError, TypeError, AttributeError):
            return {**result, 'status': 'invalid_response', 'message': 'Ollama returned invalid model metadata. Check its local API and restart Ollama.'}

    def assess(self, candidates, preferences=None, cancel=None, category='educational'):
        # Constrain evidence to real excerpts instead of asking a small model to copy
        # arbitrary prose perfectly. Scores/reasons/suitability still come from the LLM.
        
        # Use category-specific system prompt
        system_prompt = get_system_prompt(category)
        logger.info('Using %s system prompt for assessment', category)
        
        schema = Assessments.model_json_schema()
        variants, supplied = [], []
        for candidate in candidates:
            words = candidate['excerpt'].split()
            quotes = [' '.join(words[i:i + 16])[:240].rsplit(' ', 1)[0] for i in range(0, len(words), 16) if len(words[i:i + 16]) >= 4]
            if not quotes:
                raise ProcessingError('Candidate has too little meaningful speech to analyze.')
            variant = copy.deepcopy(Assessment.model_json_schema())
            variant['properties']['candidate_id']['enum'] = [candidate['id']]
            variant['properties']['evidence']['enum'] = quotes
            variants.append(variant)
            supplied.append({'candidate_id': candidate['id'], 'excerpt': candidate['excerpt'], 'evidence_options': quotes})
        schema['properties']['assessments'].update({'minItems': len(candidates), 'maxItems': len(candidates), 'items': {'anyOf': variants}})
        payload = {'model': self.settings.ollama_model, 'stream': False, 'format': schema,
                   'keep_alive': '5m', 'options': {'temperature': 0, 'seed': 42, 'num_ctx': 8192, 'num_predict': 1600},
                   'messages': [{'role': 'system', 'content': system_prompt},
                                {'role': 'user', 'content': json.dumps(supplied, ensure_ascii=False)}]}
        if preferences:
            payload['messages'][0]['content'] += (f'\nThe editor requests up to {preferences.clip_count} distinct clips, '
                f'each {preferences.min_seconds:g}–{preferences.max_seconds:g} seconds. These windows already satisfy that range. '
                'Assess each on its own merits. The count is a maximum, never a quota; reject weak content.')
        if self.settings.ollama_model.startswith('qwen3:'):
            payload['think'] = False
        last_error = None
        # One bounded schema retry; never fabricate replacement scores.
        for attempt in range(2):
            check_cancel(cancel)
            try:
                with self._client(self.settings.ollama_timeout) as client:
                    response = client.post('/api/chat', json=payload)
                    response.raise_for_status()
                    body = response.json()
                check_cancel(cancel)
                if body.get('done_reason') == 'length':
                    raise ValueError('Response was truncated')
                parsed = Assessments.model_validate_json(body['message']['content'])
                expected = {c['id']: c for c in candidates}
                if len(parsed.assessments) != len(expected) or {a.candidate_id for a in parsed.assessments} != set(expected):
                    raise ValueError('Missing, duplicate or unknown candidate IDs')
                for assessment in parsed.assessments:
                    quote = normalized(assessment.evidence)
                    if len(quote.split()) < 3 or quote not in normalized(expected[assessment.candidate_id]['excerpt']):
                        raise ValueError('Evidence must be a verbatim quote from the candidate')
                return parsed.assessments
            except httpx.TimeoutException:
                raise ProcessingError('Local AI timed out. Try a smaller installed model or increase CLIPFORGE_OLLAMA_TIMEOUT.') from None
            except httpx.HTTPError:
                logger.warning('Ollama request failed', exc_info=True)
                raise ProcessingError('Ollama could not evaluate clips. Check it is running, the local model is installed, and enough memory is free.') from None
            except (ValidationError, ValueError, KeyError, TypeError, AttributeError) as error:
                # ValidationError includes input text; never put transcript/model output in logs.
                last_error = type(error).__name__
                if attempt == 0:
                    payload['messages'].append({'role': 'user', 'content': 'The output failed validation. Return every supplied candidate_id exactly once, valid integer scores, and evidence copied verbatim. JSON only.'})
        logger.warning('Invalid Ollama assessment after retry: %s', last_error)
        raise ProcessingError('Local AI returned invalid or ungrounded results twice. No suggestions were saved. Retry or configure a more capable local model.')
