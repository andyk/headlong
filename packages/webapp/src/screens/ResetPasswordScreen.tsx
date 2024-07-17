import { ResetPassword } from '../components/auth/ResetPassword';

/**
 * ResetPasswordScreenProps
 */
export type ResetPasswordScreenProps = {
  supabaseClient: any
}

/**
 * ResetPasswordScreen
 */
export function ResetPasswordScreen({supabaseClient} : ResetPasswordScreenProps) {
  return (
    <div className="App flex flex-col max-h-screen">
      <div className="w-screen flex justify-center">
        <ResetPassword supabaseClient={supabaseClient} />
      </div>
    </div>
  )
}
