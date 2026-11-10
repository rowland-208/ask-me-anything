function App() {
  return (
    <main className="page">
      <header className="site-header">
        <a className="wordmark" href="./" aria-label="Ask me anything home">
          ama<span>.</span>
        </a>
        <span className="header-note">A space for curious minds</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Good conversations start with a question</p>
        <h1 id="page-title">
          Ask me
          <br />
          <span>anything.</span>
        </h1>
        <p className="intro">
          A little corner of the internet for questions, ideas, and the things
          you have always wanted to know.
        </p>
        <div className="coming-soon">
          <span className="status-dot" aria-hidden="true" />
          <span>Something thoughtful is on its way</span>
        </div>
      </section>

      <footer className="site-footer">
        <span>Stay curious.</span>
        <span>Ask me anything <span aria-hidden="true">↗</span></span>
      </footer>
    </main>
  )
}

export default App
