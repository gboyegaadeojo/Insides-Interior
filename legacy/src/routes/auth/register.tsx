import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../../lib/firebase/config';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      setError('Firebase is not configured.');
      return;
    }
    setError('');
    setIsLoading(true);
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      const trimmedName = fullName.trim();
      if (trimmedName) {
        await updateProfile(user, { displayName: trimmedName });
      }

      if (db) {
        await setDoc(doc(db, 'users', user.uid), {
          id: user.uid,
          email: user.email,
          name: trimmedName,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
      }

      navigate('/dashboard');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError("An account with this email already exists. Try signing in instead, or use 'Forgot password' if you originally signed up with Google.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else {
        setError('Failed to create an account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
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
          createdAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
      }
      navigate('/dashboard');
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError("Sign-in popup was closed before completing.");
      } else {
        setError('Failed to sign up with Google. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-subtle p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">Create an account</CardTitle>
          <CardDescription>Enter your details below to create your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailRegister} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-error bg-error/10 border border-error/20 rounded-md">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="fullName" className="text-sm font-medium leading-none text-primary">
                Full name
              </label>
              <Input 
                id="fullName" 
                type="text" 
                placeholder="John Doe" 
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

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
              <label htmlFor="password" className="text-sm font-medium leading-none text-primary">
                Password
              </label>
              <Input 
                id="password" 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create account'}
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
            onClick={handleGoogleRegister}
            disabled={isLoading}
          >
            Google
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-secondary">
          Already have an account?{' '}
          <Link to="/login" className="ml-1 text-primary font-medium hover:underline">
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
