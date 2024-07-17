import { useNavigate } from "react-router-dom";
import { pathLogin } from '../../routes';

/**
 * SignOutButtonProps
 */
export type SignOutButtonProps = {
  supabaseClient: any,
}

/**
 * SignOutButton
 */
export function SignOutButton({ supabaseClient }: SignOutButtonProps) {
  const navigate = useNavigate()

  return (
    <button className="bg-gray-800 text-white py-2 px-4 rounded mx-2" onClick={
      async function signOut() {
        const { error } = await supabaseClient.auth.signOut()
        if (error) {
          console.log("Error signing out")
        }

        navigate(pathLogin)
      }
    }>
      Sign out
    </button>
  )
}

