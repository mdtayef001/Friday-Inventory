"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, PackageX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState, ListSkeleton, PageBody, PageHeader, QueryError } from "@/components/common"
import { ProductForm } from "@/components/product-form"
import { ApiError } from "@/lib/api/errors"
import { useProduct } from "@/lib/data/queries"

export function EditProductView({ id }: { id: string }) {
  const router = useRouter()
  const { data: product, error, refetch } = useProduct(id)

  if (error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <PageBody>
        <QueryError error={error} onRetry={() => refetch()} />
      </PageBody>
    )
  }
  if (!product && !error) {
    return (
      <PageBody>
        <ListSkeleton />
      </PageBody>
    )
  }
  if (!product) {
    return (
      <PageBody>
        <EmptyState icon={PackageX} title="Product not found" description="It may have been deleted." />
      </PageBody>
    )
  }

  return (
    <PageBody className="max-w-3xl">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href={`/products/${id}`} />} nativeButton={false}>
        <ArrowLeft />
        {product.name}
      </Button>
      <PageHeader title="Edit product" description="Stock is changed from the product page, not here." />
      <Card>
        <CardContent>
          <ProductForm product={product} onDone={() => router.push(`/products/${id}`)} onCancel={() => router.push(`/products/${id}`)} />
        </CardContent>
      </Card>
    </PageBody>
  )
}
