/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/card"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableRowActions } from "../components/ui/table"
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "../components/ui/drawer"
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "../components/ui/command"
import { Edit2, MoreHorizontal, Trash } from "lucide-react"
import { useState, useEffect } from "react"

export default function DesignSystem() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <div className="min-h-screen bg-subtle text-primary p-16 font-sans">
      <div className="max-w-4xl mx-auto space-y-16">
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Design Tokens Test</h1>
          <p className="text-secondary mt-2">Visual proof of the InvoiceOS token system.</p>
        </div>

        {/* Colors */}
        <section className="space-y-4">
          <h2 className="text-sm uppercase tracking-wider text-secondary font-medium">Colors</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            <div className="p-4 rounded-md bg-surface border border-border">
              <div className="h-12 w-full bg-surface border border-border rounded-sm mb-3"></div>
              <p className="text-sm font-medium">Surface</p>
              <p className="text-xs text-secondary">bg-surface</p>
            </div>
            
            <div className="p-4 rounded-md bg-surface border border-border">
              <div className="h-12 w-full bg-subtle border border-border rounded-sm mb-3"></div>
              <p className="text-sm font-medium">Subtle</p>
              <p className="text-xs text-secondary">bg-subtle</p>
            </div>
            
            <div className="p-4 rounded-md bg-surface border border-border">
              <div className="h-12 w-full bg-primary rounded-sm mb-3"></div>
              <p className="text-sm font-medium text-primary">Primary Text</p>
              <p className="text-xs text-secondary">bg-primary / text-primary</p>
            </div>
            
            <div className="p-4 rounded-md bg-surface border border-border">
              <div className="h-12 w-full bg-accent rounded-sm mb-3"></div>
              <p className="text-sm font-medium">Accent</p>
              <p className="text-xs text-secondary">bg-accent</p>
            </div>

          </div>
        </section>

        {/* Status Colors */}
        <section className="space-y-4">
          <h2 className="text-sm uppercase tracking-wider text-secondary font-medium">Semantic Status</h2>
          <div className="flex gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-sm">
              <div className="w-2 h-2 rounded-full bg-success"></div>
              <span className="text-sm font-medium text-success">Paid</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-sm">
              <div className="w-2 h-2 rounded-full bg-warning"></div>
              <span className="text-sm font-medium text-warning">Pending</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-sm">
              <div className="w-2 h-2 rounded-full bg-error"></div>
              <span className="text-sm font-medium text-error">Overdue</span>
            </div>
          </div>
        </section>

        {/* Typography & Spacing Hierarchy */}
        <section className="space-y-8 bg-surface p-8 rounded-lg border border-border">
          <div>
            <h2 className="text-sm uppercase tracking-wider text-secondary font-medium mb-4">Typography & Spacing</h2>
            <div className="space-y-4"> {/* space-4 = 16px */}
              <h1 className="text-3xl font-semibold text-primary">Heading 1 (text-3xl)</h1>
              <h2 className="text-2xl font-medium text-primary">Heading 2 (text-2xl)</h2>
              <p className="text-base text-secondary max-w-2xl">
                Body text (text-base). This paragraph demonstrates the 16px spacing between elements. 
                The surrounding container has 32px padding (p-8). The contrast between primary 
                and secondary text creates natural hierarchy without heavy font weights.
              </p>
            </div>
          </div>
        </section>

        {/* UI Components */}
        <section className="space-y-4">
          <h2 className="text-sm uppercase tracking-wider text-secondary font-medium">Core Components</h2>
          
          <Card padding="default">
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
              <CardDescription>Enter the details for this invoice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4 items-center">
                <Button variant="default">Primary Button</Button>
                <Button variant="secondary">Secondary Button</Button>
                <Button variant="ghost">Ghost Button</Button>
                <Button variant="secondary" onClick={() => setOpen(true)} className="ml-auto">
                  Search <kbd className="ml-2 font-mono text-[10px] bg-subtle px-1 rounded-sm border border-border">⌘K</kbd>
                </Button>
              </div>
              <div className="max-w-sm">
                <Input placeholder="Invoice Number (e.g. INV-001)" />
              </div>

              <div className="mt-8">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow density="comfortable">
                      <TableCell className="font-medium">Design System</TableCell>
                      <TableCell>1</TableCell>
                      <TableCell className="text-right">$5,000.00</TableCell>
                      <TableCell>
                        <TableRowActions>
                          <Button variant="ghost" size="icon"><Edit2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon"><Trash className="h-4 w-4 text-error" /></Button>
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                    <TableRow density="comfortable">
                      <TableCell className="font-medium">Frontend Dev</TableCell>
                      <TableCell>1</TableCell>
                      <TableCell className="text-right">$10,000.00</TableCell>
                      <TableCell>
                        <TableRowActions>
                          <Button variant="ghost" size="icon"><Edit2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon"><Trash className="h-4 w-4 text-error" /></Button>
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="secondary">Open Drawer Test</Button>
                </DrawerTrigger>
                <DrawerContent className="w-[300px] sm:w-[400px]">
                  <DrawerHeader>
                    <DrawerTitle>Customer Profile</DrawerTitle>
                    <DrawerDescription>View and edit customer details.</DrawerDescription>
                  </DrawerHeader>
                  <div className="flex-1 p-6 space-y-4">
                    <p className="text-sm text-secondary">This is a drawer sliding in from the right per the motion spec.</p>
                    <Input placeholder="Customer Name" defaultValue="Acme Corp" />
                  </div>
                  <DrawerFooter>
                    <DrawerClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DrawerClose>
                    <Button variant="default">Save Changes</Button>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
              
              <Button>Save Invoice</Button>
            </CardFooter>
          </Card>
        </section>

        <CommandDialog open={open} onOpenChange={setOpen}>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Suggestions">
              <CommandItem>Create New Invoice</CommandItem>
              <CommandItem>Add Customer</CommandItem>
              <CommandItem>View Reports</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>

      </div>
    </div>
  );
}
