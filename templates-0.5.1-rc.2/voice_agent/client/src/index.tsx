import './index.css';

import { ThemeProvider } from '@mui/material';
import ReactDOM from 'react-dom/client';

import App from './App';
import theme from './app/theme';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <ThemeProvider theme={theme}>
    <App />
  </ThemeProvider>,
);
