import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Simulator from './pages/Simulator';
import Comparison from './pages/Comparison';
import PatGenerator from './pages/PatGenerator';
import Onboarding from './pages/Onboarding';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="simulator" element={<Simulator />} />
        <Route path="comparison" element={<Comparison />} />
        <Route path="pat-generator" element={<PatGenerator />} />
        <Route path="onboarding" element={<Onboarding />} />
      </Route>
    </Routes>
  );
}

export default App;