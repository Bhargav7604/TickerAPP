import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ThemeProvider } from './theme';

// Sample data is compiled in only for explicitly enabled local design builds.
const Root = process.env.REACT_APP_DESIGN_PREVIEW === 'true'
  && new URLSearchParams(window.location.search).get('preview') === 'design'
  ? require('./designPreview').default : App;

ReactDOM.render(
  <React.StrictMode>
    <ThemeProvider><Root /></ThemeProvider>
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
