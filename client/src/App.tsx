import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ToastHost } from './ui/toast';

const HomePage = lazy(() => import('./pages/home/HomePage'));
const PlaygroundPage = lazy(() => import('./pages/playground/PlaygroundPage'));
const StudioHome = lazy(() => import('./pages/studio/StudioHome'));
const StudioPage = lazy(() => import('./pages/studio/StudioPage'));

export function App() {
  return (
    <>
      <Suspense fallback={<div className="page-loading"><div className="spinner" /></div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/playground/:id" element={<PlaygroundPage />} />
          <Route path="/studio" element={<StudioHome />} />
          <Route path="/studio/:id" element={<StudioPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
