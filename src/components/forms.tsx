'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { LoaderCircle, Eye, EyeOff } from '@/components/icons';
import { mutateAction, loginAction } from '@/lib/actions';
import type { ActionState } from '@/lib/types';

export function Submit({
  children,
  className = 'btn primary',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle size={18} className="spin" />
          {' '}در حال انجام…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ActionForm({
  children,
  action,
  id,
  label = 'ذخیره اطلاعات',
  confirm,
  className = '',
  danger = false,
}: {
  children?: React.ReactNode;
  action: string;
  id?: number;
  label?: string;
  confirm?: string;
  className?: string;
  danger?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    mutateAction,
    {},
  );

  return (
    <form
      action={formAction}
      className={'action-form ' + className}
      onSubmit={e => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="action" value={action} />

      {id && <input type="hidden" name="id" value={id} />}

      {children}

      {state.error && (
        <div role="alert" className="alert error">
          {state.error}
        </div>
      )}

      <Submit className={danger ? 'btn danger' : 'btn primary'}>
        {label}
      </Submit>
    </form>
  );
}

export function PasswordInput({
  required = false,
  editing = false,
}: {
  required?: boolean;
  editing?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="field">
      {editing ? 'رمز عبور جدید (اختیاری)' : 'رمز عبور'}

      <span className="password-field">
        <input
          name="password"
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={editing || required ? 10 : undefined}
          maxLength={64}
          autoComplete="new-password"
          dir="ltr"
          placeholder={editing ? 'بدون تغییر بگذارید' : 'حداقل ۱۰ نویسه'}
        />

        <button
          type="button"
          className="icon-button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? 'پنهان کردن رمز' : 'نمایش رمز عبور'}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </span>
    </label>
  );
}

export function LoginForm({ siteName = 'Nexora' }: { siteName?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(
    loginAction,
    {},
  );
  const [visible, setVisible] = useState(false);

  return (
    <form action={action} className="login-form">
      <label className="field">
        نام کاربری
        <input
          name="username"
          dir="ltr"
          autoComplete="username"
          placeholder="username"
          required
          maxLength={64}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      <label className="field">
        رمز عبور
        <span className="password-field">
          <input
            name="password"
            type={visible ? 'text' : 'password'}
            dir="ltr"
            autoComplete="current-password"
            required
            maxLength={128}
            placeholder="رمز عبور خود را وارد کنید"
          />

          <button
            className="icon-button"
            type="button"
            aria-label="نمایش یا پنهان کردن رمز"
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </span>
      </label>

      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}

      <Submit>
        ورود به {siteName} <span aria-hidden="true">←</span>
      </Submit>

      <p className="form-footnote">
        برای دریافت حساب کاربری با مدیر تماس بگیرید.
      </p>
    </form>
  );
}
