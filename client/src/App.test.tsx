import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

test('renders the downloader interface', () => {
  render(<App />);
  expect(screen.getByText(/download video\/audio/i)).toBeInTheDocument();
});
