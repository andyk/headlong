import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserRouter,
  RouterProvider,
  redirect,
} from "react-router-dom";
import App from './App.tsx'
import './index.css'
import supabase from './supabase';
import * as Routes from './routes';
import { LoginScreen, ResetPasswordScreen } from './screens';

async function confirmSession() {
  const session = await supabase.auth.getSession().then(({ data: { session } }) => {
    return session
  })

  if (!session) {
    throw redirect(Routes.pathLogin);
  }

  return session
}

const router = createBrowserRouter([
  {
    path: Routes.pathRoot,
    element: (<App/>),
    loader: confirmSession
  },
  {
    path: Routes.pathLogin,
    element: (<LoginScreen supabaseClient={supabase}/>),
  },
  {
    path: Routes.pathResetPassword,
    element: <ResetPasswordScreen supabaseClient={supabase}/>,
    loader: confirmSession,
  },
]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
