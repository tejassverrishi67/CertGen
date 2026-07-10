'use client';

import { useState } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate certificates');
      }

      // Trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'certificates.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <h1>Certificate Generator</h1>
      
      {error && <div className="error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="gotenbergUrl">Gotenberg URL:</label>
          <input 
            type="url" 
            id="gotenbergUrl" 
            name="gotenbergUrl" 
            placeholder="http://localhost:3000"
            defaultValue="http://localhost:3000"
            required 
          />
          <small>Ensure the Gotenberg instance is reachable from this deployment.</small>
        </div>

        <div className="form-group">
          <label htmlFor="template">Word Template (.docx):</label>
          <input 
            type="file" 
            id="template" 
            name="template" 
            accept=".docx" 
            required 
          />
        </div>

        <div className="form-group">
          <label htmlFor="datablock">Data Block:</label>
          <textarea 
            id="datablock" 
            name="datablock" 
            rows={10} 
            placeholder="Name: Rishi1,Vishnu2&#10;Designations:&#10;Student,CIT,Chennai1&#10;Dean,CIT,Chennai1-3&#10;Paper Title: AI BASED APP FOR TASK&#10;DOI: 13706"
            required 
          ></textarea>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Generating...' : 'Generate Certificates'}
        </button>
      </form>
    </main>
  );
}
