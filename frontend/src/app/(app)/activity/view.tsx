"use client"

import { useMemo, useState } from "react"
import { History, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { EmptyState, PageBody, PageHeader, SimpleSelect } from "@/components/common"
import { formatDateTime, timeAgo } from "@/lib/format"
import { useStore } from "@/lib/store"

export function ActivityView() {
  const activity = useStore((s) => s.activity)
  const [query, setQuery] = useState("")
  const [person, setPerson] = useState("all")

  const people = useMemo(() => [...new Set(activity.map((a) => a.user))].sort(), [activity])
  const q = query.trim().toLowerCase()
  const rows = activity.filter(
    (a) => (person === "all" || a.user === person) && (!q || `${a.action} ${a.detail}`.toLowerCase().includes(q)),
  )

  return (
    <PageBody className="max-w-4xl">
      <PageHeader title="Activity log" description="Every change made by your team, newest first." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity…" className="h-9 pl-9" />
        </div>
        <SimpleSelect
          value={person}
          onChange={setPerson}
          options={[{ value: "all", label: "Everyone" }, ...people.map((p) => ({ value: p, label: p }))]}
          className="h-9! sm:w-52"
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No activity found" />
      ) : (
        <Card>
          <CardContent>
            <ol className="relative space-y-5 border-l pl-6">
              {rows.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full bg-primary ring-4 ring-card" />
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <p className="text-sm">
                      <span className="font-medium">{a.user}</span> <span className="text-muted-foreground">·</span> {a.action}
                    </p>
                    <time className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(a.at)}>
                      {timeAgo(a.at)}
                    </time>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.detail}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </PageBody>
  )
}
