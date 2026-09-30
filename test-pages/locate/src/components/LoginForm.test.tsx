import { render, screen } from '@testing-library/react';
import { LoginForm } from './LoginForm';

it('renders the submit button', () => {
  render(<LoginForm onSubmit={() => {}} />);
  expect(screen.getByText('Sign in to your account')).toBeTruthy();
});
