const AUDIO_EXT = '.m4a'
const TRANSCRIPT_EXT = '.md'
const RATING_RE = /^\[(.{5})\]\s*/
const DURATION_RE = /\s*\{(\d+):(\d+)\}\.m4a$/
const TRIMMED_RE = /\s*\{(\d+):(\d+)\}\s*\(trimmed\)\s*\{(\d+):(\d+)\}\.m4a$/

export function parseFilename(filename) {
  const ratingMatch = filename.match(RATING_RE)
  const durationMatch = filename.match(DURATION_RE)
  if (!ratingMatch && !durationMatch) return null

  const rating = ratingMatch ? ratingMatch[1] : '_____'
  const title = filename
    .replace(RATING_RE, '')
    .replace(DURATION_RE, '')
    .trim()
  const duration = durationMatch
    ? `${String(parseInt(durationMatch[1])).padStart(2, '0')}:${String(parseInt(durationMatch[2])).padStart(2, '0')}`
    : null

  return { rating, title, duration }
}

export function buildFilename(rating, title, durationStr) {
  return `[${rating}] ${title} {${durationStr}}${AUDIO_EXT}`
}

export function withRating(filename, newRating) {
  const parsed = parseFilename(filename)
  if (!parsed) return filename
  return buildFilename(newRating, parsed.title, parsed.duration || '00:00')
}

export function withDuration(filename, newDurStr) {
  const parsed = parseFilename(filename)
  if (!parsed) return filename
  return buildFilename(parsed.rating, parsed.title, newDurStr)
}

export function transcriptName(audioFilename) {
  return audioFilename.slice(0, -AUDIO_EXT.length) + TRANSCRIPT_EXT
}

export function formatDuration(seconds) {
  if (!seconds) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDurationStr(seconds) {
  if (seconds == null) return null
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export { AUDIO_EXT, TRANSCRIPT_EXT, DURATION_RE, TRIMMED_RE }
