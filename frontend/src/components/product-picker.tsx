"use client"

import { useState } from "react"
import { ChevronsUpDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDebounced, useProducts, type Params } from "@/lib/data/queries"
import type { Product } from "@/lib/types"
import { cn } from "@/lib/utils"

const SHOWN = 20

/**
 * Pick a product by typing its name, SKU or barcode. The server does the search,
 * so it stays fast with any number of products.
 */
export function ProductPicker({
  value,
  onChange,
  params,
  describe,
  placeholder = "Choose product",
  allLabel,
  onAll,
  disabled,
  className,
  onCreate,
}: {
  value: Product | null
  onChange: (product: Product) => void
  /** For filters: an "All products" choice at the top of the list, like the other filter selects. */
  allLabel?: string
  onAll?: () => void
  /** Server filters, e.g. { location, inStock: true } for products with some left there. */
  params?: Params
  /** Shown on the right of each option, e.g. "12 free". Defaults to the SKU. */
  describe?: (product: Product) => string
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Offers "Create <what was typed>" at the bottom, for a product that doesn't exist yet. */
  onCreate?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim())
  const { data, isFetching, error } = useProducts({ page: 1, search: term, ordering: "name", ...params }, { pageSize: SHOWN, enabled: open })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" role="combobox" aria-expanded={open} className={cn("w-full min-w-0 justify-between font-normal", className)} disabled={disabled} />}
      >
        <span className={cn("truncate", !value && !allLabel && "text-muted-foreground")}>{value ? value.name : (allLabel ?? placeholder)}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search name, SKU, barcode…" />
          <CommandList>
            {error ? (
              <p className="px-2 py-6 text-center text-sm text-destructive">{error.message}</p>
            ) : (
              <CommandEmpty>{isFetching || !data ? "Searching…" : "No products found."}</CommandEmpty>
            )}
            {allLabel && onAll && !term && (
              <CommandItem
                value="all"
                onSelect={() => {
                  onAll()
                  setOpen(false)
                }}
              >
                {allLabel}
              </CommandItem>
            )}
            {data?.results.map((p) => (
              <CommandItem
                key={p.id}
                value={p.id}
                onSelect={() => {
                  onChange(p)
                  setOpen(false)
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{describe ? describe(p) : p.sku}</span>
              </CommandItem>
            ))}
            {data && data.count > data.results.length && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Showing {data.results.length} of {data.count}. Type to narrow it down.
              </p>
            )}
          </CommandList>
          {onCreate && (
            <div className="border-t p-1">
              <CommandItem
                value="create-new-product"
                onSelect={() => {
                  onCreate(search.trim())
                  setOpen(false)
                  setSearch("")
                }}
                className="font-medium text-primary data-selected:bg-primary/10 data-selected:text-primary data-selected:*:[svg]:text-primary"
              >
                <Plus />
                {search.trim() ? `Create “${search.trim()}”` : "Create a new product"}
              </CommandItem>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
