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
    <button className="bg-gray-800 text-white py-2 px-4 rounded mx-2" onClick={
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

