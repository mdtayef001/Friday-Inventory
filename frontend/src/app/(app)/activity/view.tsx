"use client"

import { useState } from "react"
import { History } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput, SimpleSelect } from "@/components/common"
import { PAGE_SIZE, useActivity, useActivityPeople, useDebounced, usePageNumber } from "@/lib/data/queries"
import { formatDateTime, timeAgo } from "@/lib/format"

export function ActivityView() {
  const [query, setQuery] = useState("")
  const [person, setPerson] = useState("all")
  const search = useDebounced(query.trim())
  const [page, setPage] = usePageNumber(search, person)
  const people = useActivityPeople()
  const { data, error, isPending, isPlaceholderData, refetch } = useActivity({ page, search, user: person === "all" ? undefined : person })
  const rows = data?.results ?? []

  return (
    <PageBody className="max-w-4xl">
      <PageHeader title="Activity log" description="Every change made by your team, newest first." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search activity…" className="flex-1" />
        <SimpleSelect
          value={person}
          onChange={setPerson}
          options={[{ value: "all", label: "Everyone" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
          className="h-9! sm:w-52"
        />
      </div>
      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No activity found" />
      ) : (
        <Card className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
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
      {data && <Pager page={data.page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} busy={isPlaceholderData} />}
    </PageBody>
  )
}
