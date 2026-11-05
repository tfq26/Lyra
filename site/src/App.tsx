import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Architecture from './pages/Architecture';
import Docs from './pages/Docs';
import Auth from './pages/Auth';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="architecture" element={<Architecture />} />
        <Route path="docs" element={<Docs />} />
        <Route path="auth" element={<Auth />} />
        <Route path="login" element={<Auth />} />
        <Route path="signup" element={<Auth />} />
        <Route path="account" element={<Auth />} />
      </Route>
    </Routes>
  );
}

export default App;
