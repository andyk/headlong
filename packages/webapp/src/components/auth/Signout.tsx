/**
 * ConnectionStatusIconProps
 */
export type SignOutButtonProps = {
  supabaseClient: any
}

/**
 * ConnectionStatusIcon
 */
export function SignOutButton({ supabaseClient }: SignOutButtonProps) {
  return (
    <button onClick={
      async function signOut() {
        const { error } = await supabaseClient.auth.signOut()
        if (error) {
          console.log("Error signing out")
        }
      }
    }>
      Sign out
    </button>
  )
}

