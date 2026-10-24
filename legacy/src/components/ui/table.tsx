import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b border-border", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("bg-subtle font-medium text-primary border-t border-border", className)}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const tableRowVariants = cva(
  "border-b border-border transition-colors hover:bg-subtle data-[state=selected]:bg-subtle group",
  {
    variants: {
      density: {
        comfortable: "h-12", // 48px
        dense: "h-9", // 36px
      },
    },
    defaultVariants: {
      density: "comfortable",
    },
  }
)

export interface TableRowProps 
  extends React.HTMLAttributes<HTMLTableRowElement>,
  VariantProps<typeof tableRowVariants> {}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, density, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(tableRowVariants({ density, className }))}
      {...props}
    />
  )
)
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-4 text-left align-middle font-medium text-secondary [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-secondary", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

// Utility for hover-reveal row actions. Apply this to a div inside the last TableCell.
const TableRowActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-end gap-2", className)}
    {...props}
  />
))
TableRowActions.displayName = "TableRowActions"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableRowActions,
}
