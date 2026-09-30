import { useTranslation } from 'react-i18next';

export function LoginForm({ onSubmit }: { onSubmit: () => void }) {
  const { t } = useTranslation();
  return (
    <form className="login-form stack-4" onSubmit={onSubmit}>
      <h2 className="login-title">Welcome back</h2>
      <input className="field-input" type="email" placeholder="Email address" />
      <button
        type="submit"
        className="btn btn-primary login-submit"
      >
        Sign in to your account
      </button>
      <a className="login-forgot" href="/forgot">{t('login.forgot')}</a>
    </form>
  );
}
