# InvoiceOS: Architecture Specification

## 1. Project & Folder Structure (Vite + React Router SPA)

InvoiceOS follows a feature-based architecture tailored for a Vite + React client-side SPA. This ensures modularity, scalability, and clean separation of concerns.

```text
/
├── src/
│   ├── App.tsx               # Root App component (Providers, Router setup)
│   ├── main.tsx              # React entry point
│   ├── index.css             # Tailwind & global CSS
│   ├── routes/               # Page-level components & routing setup
│   │   ├── auth/             # Login, register, forgot-password
│   │   ├── dashboard/        # Dashboard overview
│   │   ├── invoices/         # Invoices module pages
│   │   ├── customers/        # Customers module pages
│   │   └── ...               # Other module pages
│   ├── components/           # Shared UI Components
│   │   ├── ui/               # Generic UI components (buttons, inputs, dialogs)
│   │   ├── layout/           # Global layout components (Sidebar, AppShell, Topbar)
│   │   └── shared/           # Domain-agnostic shared components (EmptyState, StatusBadge)
│   ├── features/             # Feature-based modules (Domain Logic)
│   │   ├── invoices/
│   │   │   ├── components/   # Feature-specific UI (InvoiceBuilder, InvoiceList)
│   │   │   ├── hooks/        # Feature-specific hooks (useInvoices, useInvoiceCalculations)
│   │   │   ├── types.ts      # Zod schemas & TS types for Invoices
│   │   │   └── utils.ts      # Invoice-specific utilities
│   │   ├── customers/        # Same structure for customers
│   │   └── ...               # Other features
│   ├── lib/                  # Core libraries & configurations
│   │   ├── firebase/         
│   │   │   └── config.ts     # Firebase initialization & exports (auth, db, storage)
│   │   ├── utils.ts          # Tailwind merge (cn) and generic utilities
│   │   └── formatters.ts     # Currency, date, and number formatting
│   ├── hooks/                # Global React Hooks
│   │   ├── use-auth.ts       # Authentication state listener
│   │   └── use-mobile.ts     # Responsive breakpoints hook
│   ├── store/                # Global State (Context)
│   │   └── command-palette.tsx # Global Cmd+K state management
│   └── types/                # Global TypeScript interfaces
```

## 2. Data Flow Strategy

**Client-Side vs. Server-Side:**
- **Primary Data Fetching:** We heavily utilize client-side Firestore SDK for real-time capabilities and optimistic updates, keeping the app feeling fast and responsive like Linear or Stripe. 
- **Real-time Listeners (`onSnapshot`):** Used sparingly and only for highly dynamic data where immediate reflection is critical (e.g., Dashboard Action Inbox, Notifications).
- **One-time Fetches (`getDocs` / `getDoc`):** The default for lists (Invoices, Customers, Items). We rely on SWR (stale-while-revalidate) patterns or React Query / standard React hooks to manage cache.
- **Client-Side Exclusive:** As a pure client-side SPA, all data fetching happens directly from the browser to Firebase. We fully leverage Firebase's offline caching, real-time sync, and security rules via the client SDK. All database interaction is authorized by Firebase Auth tokens.

## 3. State Management Approach

- **Server State / Database State:** Managed directly by Firebase client SDK hooks (e.g., tracking loading, error, and data states for Firestore collections).
- **Form State:** `react-hook-form` paired with `@hookform/resolvers/zod` handles all form state (Invoice Builder, Settings, Customer Creation). This ensures strictly typed forms, high performance (minimal re-renders), and robust validation.
- **Global UI State:** React Context is used exclusively for global UI toggles that don't change frequently (e.g., Theme/Dark Mode, Command Palette open/close state, Sidebar collapse state).
- **Local UI State:** Standard `useState` and `useReducer` for component-level state (e.g., accordion toggle, drawer open/close).

## 4. Authentication Strategy

- **Core:** Firebase Authentication.
- **Providers:** Email/Password and Google Sign-In.
- **Account Linking:**
  - Configured globally in Firebase: "Link accounts that use the same email."
  - When a user signs in via Google with an email that already exists via Email/Password, Firebase automatically merges them under a single UID.
- **Session Handling & Protected Routes:**
  - A global `AuthProvider` component listens to `onAuthStateChanged`.
  - Client-side Route Guards (e.g., a `<ProtectedRoute>` wrapper component) protect authenticated routes. It checks the AuthProvider's state to prevent rendering unauthorized content.
  - If unauthenticated, redirect to `/login`. If authenticated and on `/login`, redirect to `/dashboard`.
- **User Document Mapping:** Firestore user documents (`/users/{uid}`) strictly map to the Firebase Auth UID. Since this is a single business owner app, there is no organizational mapping. The UID is the tenant. All Firestore rules will validate `request.auth.uid == resource.data.userId`.

## 5. Naming Conventions & Code Organization

- **Files & Folders:** `kebab-case` for all files and directories (e.g., `invoice-builder.tsx`, `use-auth.ts`). Component entry points may use standard React naming like `index.tsx`.
- **Components:** `PascalCase` for React components (e.g., `InvoiceList`, `CustomerProfileDrawer`).
- **Hooks:** `camelCase` prefixed with `use` (e.g., `useInvoices`, `useCustomerForm`).
- **Types/Interfaces:** `PascalCase`. Prefer Zod inferred types: `type Invoice = z.infer<typeof InvoiceSchema>;`.
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_FILE_SIZE`, `DEFAULT_CURRENCY`).
- **Firebase Collections:** `camelCase` and pluralized (e.g., `invoices`, `customers`, `activityLogs`).

## 6. Error Handling & Loading State Conventions

- **Loading States:**
  - No generic full-page spinners.
  - We use Skeleton loaders matching the target UI components (e.g., `TableSkeleton`, `CardSkeleton`).
  - React `<Suspense>` boundaries and local component loading states are used for page transitions.
- **Error Handling:**
  - **Form Validation:** Zod schemas provide inline, immediate feedback underneath form inputs.
  - **Data Fetching:** Handled gracefully. If a list fails to load, a specialized `ErrorState` component is shown with a "Retry" button. React Error Boundaries catch rendering errors.
  - **Mutations (Saves/Deletes):** Wrapped in `try/catch`. 
    - Success -> Toast notification (e.g., "Invoice sent successfully").
    - Error -> Toast notification with actionable text (e.g., "Failed to save invoice. Please check your connection.").

## 8. Styling & Animations

- **Styling:** Tailwind CSS is used exclusively for all styling.
- **Animations:** Framer Motion has been removed from the stack in favor of native CSS transitions (e.g., `tailwindcss-animate`) to reduce bundle size and leverage hardware-accelerated CSS animations.

## 9. Future Extensibility (Cloud Functions)

While the initial architecture is entirely client-side, **Firebase Cloud Functions** is designated as the intended future home for any server-side scheduled or triggered logic (such as sending automatic email reminders). By utilizing Cloud Functions paired with a transactional email API (like Resend or SendGrid), we can introduce automated background jobs without violating the "Firebase-only" architectural constraint or requiring an external custom server. The database schema is designed with this future seam in mind.
