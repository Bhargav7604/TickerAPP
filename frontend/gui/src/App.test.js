import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login form for anonymous users', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /utraders ticker/i })).toBeInTheDocument();
});
