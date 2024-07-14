/**
 * ConnectionStatusIconProps
 */
export type ConnectionStatusIconProps = {
  connected: boolean
}

/**
 * ConnectionStatusIcon
 */
export function ConnectionStatusIcon({ connected }: ConnectionStatusIconProps) {
  return connected ? ConnectedIcon() : DisconnectedIcon()
}

/**
 * ConnectedIcon - Green circle
 */
export function ConnectedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5 text-green-500"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-10.293a1 1 0 00-1.414-1.414L9 9.586 7.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/**
 * DisconnectedIcon - Red circle (outline) with a red "X"
 */
export function DisconnectedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20">
      {/* Red outlined circle with black fill */}
      <circle cx="10" cy="10" r="9" stroke="#ef4444" fill="none" strokeWidth="2" />{" "}
      {/* Red X */}
      <path stroke="#ef4444" strokeLinecap="round" strokeWidth="2" d="M6 6l8 8m0 -8l-8 8" />
    </svg>
  )
}
