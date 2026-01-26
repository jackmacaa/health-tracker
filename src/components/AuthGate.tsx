import { useEffect, useState } from "react";
import { supabase, missingEnv } from "../lib/supabase";

interface Props {
  children: (userId: string) => JSX.Element;
}

export default function AuthGate({ children }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (missingEnv) {
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setUserId(data.session?.user.id ?? null);
        setLoading(false);
      } catch (err) {
        if (mounted) {
          setLoading(false);
          setError("Failed to load auth. Check env vars.");
        }
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
      mounted = false;
    };
  }, []);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  if (missingEnv) {
    return (
      <div className="container">
        <div className="card stack" style={{ marginTop: "20px" }}>
          <h2 style={{ margin: 0, color: "#ffb4b4" }}>⚠️ Setup Required</h2>
          <p>
            Create a <strong>Supabase project</strong> at{" "}
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#0ea5e9" }}
            >
              supabase.com
            </a>
          </p>
          <ol style={{ marginTop: "8px" }}>
            <li>Get your Project URL and anon key from Settings → API</li>
            <li>
              Create .env.local with:
              <pre
                style={{
                  background: "#0d1526",
                  padding: "8px",
                  borderRadius: "6px",
                  overflow: "auto",
                  fontSize: "12px",
                }}
              >
                VITE_SUPABASE_URL=https://your-project.supabase.co
                VITE_SUPABASE_ANON_KEY=your_anon_key
              </pre>
            </li>
            <li>Run SQL from supabase/schema.sql in Supabase SQL Editor</li>
            <li>Enable Email auth in Supabase → Authentication</li>
            <li>Create a user (Users tab)</li>
            <li>Refresh this page</li>
          </ol>
        </div>
      </div>
    );
  }

  if (loading)
    return (
      <div className="container">
        <p>Loading…</p>
      </div>
    );
  if (!userId) {
    return (
      <div className="container">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Sign in</h2>
          {missingEnv ? (
            <div className="item-sub" style={{ color: "#ffb4b4" }}>
              Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in
              .env.local
            </div>
          ) : (
            <form className="stack" onSubmit={handleSignIn}>
              <div className="stack">
                <label>Email</label>
                <input type="email" name="email" required placeholder="you@example.com" />
              </div>
              <div className="stack">
                <label>Password</label>
                <input type="password" name="password" required />
              </div>
              {error && (
                <div className="item-sub" style={{ color: "#ffb4b4" }}>
                  {error}
                </div>
              )}
              <button className="btn" type="submit">
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }
  return children(userId);
}
