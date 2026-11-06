# Content Understanding and Category Detection

ClipForge 0.3 introduces universal content understanding - the system now automatically detects what type of video you're analyzing and adapts its clip discovery strategy accordingly.

## Supported Content Categories

### Educational
**Detects**: Tutorials, explanations, technical content, courses, how-to guides

**Looks for**: Explanatory language, technical terms, teaching patterns, question-answer formats, step-by-step instructions

**Discovery Strategy**: Finds complete explanations, useful examples, concrete learning moments. Emphasizes context completeness and clear delivery.

**Best for**: Programming tutorials, lecture segments, skill demonstrations, educational explainers

### Podcast
**Detects**: Interviews, discussions, conversational content, talk shows

**Looks for**: Conversational markers ("I think", "you know", "in my experience"), opinions, storytelling patterns

**Discovery Strategy**: Values genuine insights, interesting opinions, engaging stories, and thought-provoking discussions. Accepts natural conversational speech patterns.

**Best for**: Interview segments, debate highlights, personal stories, hot takes, discussion topics

### Gaming
**Detects**: Gameplay, streaming, gaming commentary, reactions

**Looks for**: Game terminology, excitement words, reaction patterns, low speech density (action focus)

**Discovery Strategy**: Prioritizes exciting action commentary, impressive plays, unexpected reactions, and funny moments.

**Best for**: Highlight reels, clutch plays, funny moments, achievement unlocks, epic reactions

### Comedy
**Detects**: Standup, sketches, humorous content, entertainment

**Looks for**: Humor keywords, joke patterns, setup-punchline structure

**Discovery Strategy**: Ensures complete jokes with proper setup and punchline. Respects comedic timing and context.

**Best for**: Joke segments, funny observations, comedic bits, humorous stories

### Documentary
**Detects**: Narrative content, informative storytelling, nature/history videos

**Looks for**: Narrative structure, scene descriptions, factual information, observational language

**Discovery Strategy**: Values compelling narrative segments, interesting facts, vivid descriptions, and natural story boundaries.

**Best for**: Documentary clips, nature scenes, historical segments, narrative moments

### Vlog
**Detects**: Personal vlogs, lifestyle content, daily updates

**Looks for**: Personal pronouns, daily life keywords, update patterns, lifestyle terminology

**Discovery Strategy**: Emphasizes authentic personal moments, relatable experiences, interesting updates, and genuine reactions.

**Best for**: Vlog highlights, personal stories, lifestyle moments, daily life snapshots

### Generic (Fallback)
**Used when**: No strong category signals detected, or mixed content

**Discovery Strategy**: Balanced approach valuing interesting moments, complete thoughts, and general engagement.

## How Category Detection Works

### Automatic Detection
After transcription completes, ClipForge analyzes:

1. **Speech Patterns**
   - Word density (how fast people speak)
   - Vocabulary diversity (variety of words used)
   - Question frequency
   - Conversational markers

2. **Content Characteristics**
   - Keyword matching per category
   - Technical terminology presence
   - Excitement and reaction patterns
   - Narrative structure indicators

3. **Confidence Scoring**
   - Each category gets a 0-1 score
   - Highest score becomes primary category
   - Confidence reflects detection certainty
   - Mixed content flagged when multiple strong signals present

### What Affects Confidence

**Higher Confidence:**
- Clear, distinctive content patterns
- Longer videos with more speech
- Consistent vocabulary and style

**Lower Confidence:**
- Very short videos (<1 minute)
- Mixed content types in one video
- Limited speech or minimal narration
- Ambiguous or generic language

### Viewing Detection Results

Check project details after transcription:
```json
{
  "detected_category": "podcast",
  "category_confidence": "0.72",
  "content_profile": {
    "category_scores": {
      "educational": 0.25,
      "podcast": 0.72,
      "gaming": 0.05,
      ...
    },
    "characteristics": {
      "question_count": 8,
      "conversational_markers": 24,
      "technical_terms": 5,
      "speech_density": 6.2
    }
  }
}
```

## Overriding Category Detection

If the automatic detection is incorrect or you want a different strategy:

### Via API
```bash
curl -X PATCH http://127.0.0.1:8000/api/projects/{uuid}/category \
  -H "Content-Type: application/json" \
  -d '{"category": "gaming"}'
```

Valid categories: `educational`, `podcast`, `gaming`, `comedy`, `documentary`, `vlog`, `generic`

### When to Override

**Override when:**
- Detection confidence is low (<0.5)
- Your video is niche or unconventional
- You want a specific discovery approach
- Mixed content where you want one style prioritized

**Examples:**
- Educational gaming tutorial → detected as "gaming", override to "educational"
- Comedic podcast → detected as "podcast", keep or override to "comedy" depending on goal
- Documentary interview → could be either, choose based on desired moments

## Impact on Clip Discovery

### Same Scoring Criteria
All categories still use the same four scoring dimensions:
- **Hook strength**: How the moment opens
- **Informational value**: What's delivered
- **Context completeness**: Self-contained with resolution
- **Clarity**: Understandability

### Different Expectations
What constitutes a "good score" changes per category:

**Educational**: 
- High informational value = concrete learning
- High completeness = resolved explanation
- Hook strength has zero weight

**Podcast**:
- High informational value = genuine insight or story
- High completeness = complete thought, not mid-conversation
- Accepts conversational filler ("um", "like")

**Gaming**:
- High informational value = excitement, skill, humor
- High completeness = setup → action → reaction
- Brief exclamations are acceptable

**Comedy**:
- High informational value = humor lands
- High completeness = setup AND punchline present
- Timing is critical

### Candidate Prioritization
Before LLM evaluation, candidates get re-prioritized:
- Podcast: Opinions and stories bubbled up
- Gaming: Excitement markers prioritized
- Comedy: Joke patterns preferred
- Documentary: Narrative segments favored
- Educational: Current heuristics (unchanged)

## Minimal Speech Videos

Videos with <18 words of meaningful speech:
- Automatically categorized as "minimal_speech"
- No LLM evaluation attempted
- Clear message explaining insufficient speech
- Discovery skipped to avoid false results

**Common causes:**
- Music videos with little speech
- Visual-heavy content
- Transcription quality issues
- Actually silent or ambient video

**Solution**: 
- Check transcription quality first
- Consider if video is suitable for speech-based clipping
- Use Re-transcribe with different settings if needed

## Best Practices

### For Best Results
1. **Use Auto-Detect language** if speech is clear
2. **Review transcript quality** before discovery
3. **Check detected category** makes sense for your content
4. **Override if needed** before running discovery
5. **Try different categories** to see which strategy works best

### Understanding Results
- **Strong clips** pass all quality thresholds
- **Lower confidence clips** shown when <5 strong found
- Category strategy affects what gets prioritized, not quality standards
- Rejection reasons logged for every candidate (check backend logs)

### Troubleshooting
**"No clips found"**:
- Check transcript has enough meaningful speech
- Verify duration range matches content structure
- Try different category if current strategy mismatches content
- Review backend logs for rejection reasons

**"Wrong category detected"**:
- Use category override API
- Submit feedback if consistently wrong for a content type
- Check if content is truly mixed (may need generic strategy)

**"Low confidence detection"**:
- Normal for short videos or mixed content
- Override to desired category before discovery
- Generic fallback is safe but less optimized

## Technical Details

### Detection Algorithm
1. Extract full text from transcript sentences
2. Count keyword matches per category
3. Analyze speech density, vocabulary, patterns
4. Apply characteristic-based score adjustments
5. Normalize scores and select highest
6. Check for mixed content (secondary category)
7. Adjust confidence based on video length and speech quantity

### Performance
- Content profiling adds <200ms to transcription
- Profile cached in database
- No impact on discovery speed
- Category selection instantaneous

### Data Storage
- Profile JSON stored in `projects.content_profile`
- Detected category in `projects.detected_category`
- User override in `projects.user_category` (takes precedence)
- Confidence score in `projects.category_confidence`

## Future Enhancements

Planned additions:
- Audio analysis (silence, music, loudness patterns)
- Visual analysis (scene changes, motion detection)
- Category-specific candidate generation (not just prioritization)
- User feedback to improve detection
- More specialized subcategories
- Confidence calibration based on real results

## Migration Notes

Existing projects from v0.2:
- Automatically get `detected_category = 'generic'` on first load
- Re-transcribe to get automatic category detection
- Or manually set category via API
- Old discovery results remain valid (educational-biased)
- New discovery after upgrade uses category-aware strategy
