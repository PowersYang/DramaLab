import SeriesDetailPage from "@/components/series/SeriesDetailPage";

interface StudioSeriesPageProps {
  params: { id: string };
}

export default function StudioSeriesPage({ params }: StudioSeriesPageProps) {
  return <SeriesDetailPage seriesId={params.id} homeHref="/studio/projects" />;
}
