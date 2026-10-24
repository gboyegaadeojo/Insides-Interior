import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase/config';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  error: string | null;
  displayName: string | null;
  firstName: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
  error: null,
  displayName: null,
  firstName: '',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setError('Firebase is not configured. Please set the environment variables in .env.');
      setLoading(false);
      return;
    }

    try {
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        setUser(currentUser);
        if (currentUser) {
          let name = currentUser.displayName;
          if (!name && db) {
            try {
              const userDocRef = doc(db, 'users', currentUser.uid);
              const userDocSnap = await getDoc(userDocRef);
              if (userDocSnap.exists() && userDocSnap.data()?.name) {
                name = userDocSnap.data().name;
              }
            } catch (err) {
              console.error('Failed to fetch user profile:', err);
            }
          }
          setUserName(name || null);
        } else {
          setUserName(null);
        }
        setLoading(false);
      }, (err) => {
        setError('An authentication error occurred. Please try again.');
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (err: any) {
      setError('An authentication error occurred. Please try again.');
      setLoading(false);
    }
  }, []);

  const signOut = async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  };

  const displayName = userName || user?.displayName || null;
  const rawName = displayName || user?.email || '';
  const firstName = rawName.includes('@') 
    ? rawName 
    : (rawName.trim().split(/\s+/)[0] || rawName);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, error, displayName, firstName }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
