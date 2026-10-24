import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../../lib/firebase/config';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      setError('Firebase is not configured.');
      return;
    }
    setError('');
    setIsLoading(true);
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many failed login attempts. Please try again later.');
      } else {
        setError('Failed to sign in. Please check your credentials and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!auth) {
      setError('Firebase is not configured.');
      return;
    }
    setError('');
    setIsLoading(true);
    
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      if (db && user) {
        await setDoc(doc(db, 'users', user.uid), {
          id: user.uid,
          email: user.email,
          name: user.displayName || '',
          updatedAt: new Date(),
        }, { merge: true });
      }
      navigate('/dashboard');
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError("Sign-in popup was closed before completing.");
      } else {
        setError('Failed to sign in with Google. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-subtle p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">Welcome back</CardTitle>
          <CardDescription>Sign in to your account to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailLogin} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-error bg-error/10 border border-error/20 rounded-md">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none text-primary">
                Email
              </label>
              <Input 
                id="email" 
                type="email" 
                placeholder="name@example.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium leading-none text-primary">
                  Password
                </label>
              </div>
              <Input 
                id="password" 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-surface px-2 text-secondary">Or continue with</span>
            </div>
          </div>

          <Button 
            type="button" 
            variant="secondary" 
            className="w-full" 
            onClick={handleGoogleLogin}
            disabled={isLoading}
          >
            Google
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-secondary">
          Don't have an account?{' '}
          <Link to="/register" className="ml-1 text-primary font-medium hover:underline">
            Sign up
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
