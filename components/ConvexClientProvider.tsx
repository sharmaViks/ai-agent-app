'use client';

import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL || '');

export default function ConvexClientProvider({
    children,
  }: Readonly<{
    children: React.ReactNode;
  }>) {
    return (
        <ClerkProvider>
           <ConvexProviderWithClerk useAuth={useAuth} client={convex}>
            {children}
           </ConvexProviderWithClerk>
        </ClerkProvider>
    );
  }