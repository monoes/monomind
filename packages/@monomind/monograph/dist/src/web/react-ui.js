export function getReactUiHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monograph</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #0d1117; color: #e6edf3; }
    input { background: #161b22; color: #e6edf3; border: 1px solid #30363d; padding: .5rem 1rem; border-radius: 6px; width: 300px; }
    button { background: #238636; color: white; border: none; padding: .5rem 1rem; border-radius: 6px; cursor: pointer; margin-left: .5rem; }
    pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow: auto; font-size: .85rem; }
    .result { padding: .5rem; border-bottom: 1px solid #30363d; }
    h1 { color: #58a6ff; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState } = React;

    function App() {
      const [query, setQuery] = useState('');
      const [results, setResults] = useState([]);
      const [progress, setProgress] = useState('');

      async function search() {
        if (!query.trim()) return;
        const res = await fetch('/api/query?q=' + encodeURIComponent(query));
        const data = await res.json();
        setResults(data.results ?? data ?? []);
      }

      async function analyze() {
        setProgress('Connecting...\\n');
        const repoPath = encodeURIComponent(window.location.pathname === '/' ? '.' : window.location.pathname);
        const es = new EventSource('/api/analyze?repoPath=' + repoPath);
        es.onmessage = (e) => {
          try {
            const ev = JSON.parse(e.data);
            if (ev.type === 'complete') {
              setProgress(p => p + 'Done: ' + ev.nodeCount + ' nodes, ' + ev.edgeCount + ' edges\\n');
              es.close();
            } else if (ev.type === 'error') {
              setProgress(p => p + 'Error: ' + ev.error + '\\n');
              es.close();
            } else {
              setProgress(p => p + '[' + (ev.phase ?? '?') + '] ' + (ev.message ?? '') + '\\n');
            }
          } catch {}
        };
        es.onerror = () => { setProgress(p => p + 'Connection error\\n'); es.close(); };
      }

      return (
        <div>
          <h1>Monograph</h1>
          <div>
            <input id="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search nodes..." onKeyDown={e => e.key === 'Enter' && search()} />
            <button id="search-btn" onClick={search}>Search</button>
            <button id="analyze-btn" onClick={analyze} style={{background:'#1f6feb'}}>Analyze</button>
          </div>
          <div id="results">
            {results.map((r, i) => <div key={i} className="result">{JSON.stringify(r)}</div>)}
          </div>
          <pre id="progress">{progress}</pre>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
}
//# sourceMappingURL=react-ui.js.map