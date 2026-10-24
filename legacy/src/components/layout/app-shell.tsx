import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './sidebar';
import Topbar from './topbar';
import { CommandPalette } from './command-palette';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '../ui/drawer';

export default function AppShell() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <div className="flex h-screen w-full bg-subtle overflow-hidden">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex-1 flex flex-col h-full min-w-0 pb-16 md:pb-0">
        <Topbar onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette 
        open={commandPaletteOpen} 
        onOpenChange={setCommandPaletteOpen} 
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription>Manage your app configuration and preferences.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col space-y-6 mt-4">
            <div>
              <h3 className="font-semibold text-base text-primary">Business Info</h3>
              <p className="text-sm text-secondary">Update your company details.</p>
            </div>
            <div>
              <h3 className="font-semibold text-base text-primary">Branding</h3>
              <p className="text-sm text-secondary">Customize your logo and colors.</p>
            </div>
            <div>
              <h3 className="font-semibold text-base text-primary">Tax Settings</h3>
              <p className="text-sm text-secondary">Configure default tax rates.</p>
            </div>
            <div>
              <h3 className="font-semibold text-base text-primary">Payment Methods</h3>
              <p className="text-sm text-secondary">Set up how you get paid.</p>
            </div>
            <div>
              <h3 className="font-semibold text-base text-primary">Preferences</h3>
              <p className="text-sm text-secondary">Manage currency and other defaults.</p>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
