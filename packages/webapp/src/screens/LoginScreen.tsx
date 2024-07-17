import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { baseUrl, pathResetPassword, pathRoot } from '../routes';
import { useEffect } from 'react';
import supabase from '../supabase';
import { useNavigate } from 'react-router-dom';

/**
 * LoginScreenProps
 */
export type LoginScreenProps = {
  supabaseClient: any
}

/**
 * LoginScreen
 */
export function LoginScreen({supabaseClient} : LoginScreenProps) {
  const navigate = useNavigate()

  useEffect(() => {
    // Get session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate(pathRoot)
      }
    })

    // Listen for auth state changes
    const { data: { subscription} } = supabase.auth.onAuthStateChange((event, session) => {
      if(session) {
        navigate(pathRoot)
      }
    })

    // Remove auth listener on exit
    return () => subscription.unsubscribe()
  }, [])

  return (
    <div className="App flex flex-col max-h-screen">
      <div className="w-screen flex justify-center">
        <Auth supabaseClient={supabaseClient}
              appearance={{theme: ThemeSupa}}
              providers={[]}
              redirectTo={baseUrl + pathResetPassword}
        />
      </div>
    </div>
  )
}
