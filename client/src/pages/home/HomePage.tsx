// TODO(home agent): 首页
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div style={{ padding: 40 }}>
      <h1>WebEDA</h1>
      <Link to="/playground">Playground</Link> · <Link to="/studio">Studio</Link>
    </div>
  );
}
