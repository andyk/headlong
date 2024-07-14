/**
 * PlayPauseIconProps
 */
export type PlayPauseIconProps = {
  isPlaying: boolean
}

/**
 * PlayPauseIcon
 */
export function PlayPauseIcon({isPlaying} : PlayPauseIconProps) {
  return isPlaying ? PauseIcon() : PlayIcon();
}

/**
 * PlayIcon
 */
export function PlayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-6 w-6"
      fill="currentColor"
      viewBox="2 5 20 14"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 5v14l11-7z"
      />
    </svg>
  )
}

/**
 * PauseIcon
 */
export function PauseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path fill="#FFFFFF" d="M6 4h4v16H6z" />
      <path fill="#FFFFFF" d="M14 4h4v16h-4z" />
    </svg> // Pause icon
  )
}
