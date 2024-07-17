/**
 * ResetPasswordProps
 */
import { ChangeEvent, useState } from 'react';
import {Icon} from 'react-icons-kit';
import {eyeOff} from 'react-icons-kit/feather/eyeOff';
import {eye} from 'react-icons-kit/feather/eye'
import { useNavigate } from 'react-router-dom';
import { pathRoot } from '../../routes';

export type ResetPasswordProps = {
  supabaseClient: any,
}

const MIN_PASSWORD_LENGTH = 8;
type status = 'typing' | 'submitting' | 'success'

/**
 * ResetPassword
 */
export function ResetPassword({supabaseClient}: ResetPasswordProps) {
  const navigate = useNavigate()

  const [password1, setPassword1] = useState('');
  const [password2, setPassword2] = useState('');
  const [errorMessage, setErrorMessage] = useState<string|null>(null);
  const [status, setStatus] = useState<status>('typing');

  async function onSubmit(event) {
    event.preventDefault();
    setStatus('submitting')
    setErrorMessage('')

    if (password1 !== password2) {
      setErrorMessage("Passwords don't match. Try again!")
      setStatus('typing')
    } else {
      const { data, error } = await supabaseClient.auth.updateUser({
        password: password1
      })

      if (error) {
        setErrorMessage(error.toString)
        setStatus('typing')
      } else {
        setStatus('success')
        navigate(pathRoot)
      }
    }
  }

  return (
    <form className="flex flex-col space-x-2 items-center" onSubmit={onSubmit}>
      <div>{`Enter a new password (${MIN_PASSWORD_LENGTH}+ characters)`}</div>
      <PasswordInput value={password1}
                     placeholder="New password"
                     onChange={(e) => setPassword1(e.target.value)}
                     disabled={status === 'submitting'} />
      <div>One more time</div>
      <PasswordInput value={password2}
                     placeholder="Confirm new password"
                     onChange={(e) => setPassword2(e.target.value)}
                     disabled={status === 'submitting'} />
      {errorMessage && <div>{errorMessage}</div>}
      {status === 'success' && <div>Success!</div>}
      <button
        disabled={
          (password1.length < MIN_PASSWORD_LENGTH) ||
          (password2.length < MIN_PASSWORD_LENGTH) ||
          (status == 'submitting')
        }
        onClick={onSubmit}
      >
        Submit
      </button>
    </form>
  )
}

export type PasswordInputProps = {
  value: String,
  placeholder: String | null,
  onChange: (event: ChangeEvent<HTMLInputElement>) => any,
  disabled: Boolean,
}

function PasswordInput({value, placeholder, onChange, disabled = false}: PasswordInputProps) {
  const [type, setType] = useState('password');
  const [icon, setIcon] = useState(eyeOff);

  const handleToggle = () => {
    if (type==='password'){
      setIcon(eye);
      setType('text')
    } else {
      setIcon(eyeOff)
      setType('password')
    }
  }

  return (
    <div>
      <div>
        <div className="mb-4 flex">
          <input
            type={type}
            name="password"
            placeholder={placeholder || "Enter password"}
            value={value}
            onChange={onChange}
            autoComplete="current-password"
            disabled={disabled}
          />
          <span className="flex justify-around items-center" onClick={handleToggle}>
                  <Icon className="absolute mr-10" icon={icon} size={25}/>
              </span>
        </div>
      </div>
    </div>
  );
}
