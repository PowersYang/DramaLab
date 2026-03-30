/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const isDocker = process.env.DOCKER_BUILD === 'true';
const useStaticExport = process.env.NEXT_STATIC_EXPORT === 'true';

// 开发态显式走 127.0.0.1，避免 Node 在 localhost 上优先解析 ::1 导致代理连不上后端。
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:17177';

const nextConfig = {
    // 开发服通过反向代理暴露到公网时，允许该外部 origin 访问 Next dev 的 /_next 资源，避免持续告警并兼容后续版本收紧。
    allowedDevOrigins: ["http://8.130.74.255:15678"],
    // 商业化工作台引入了动态路径路由；只有显式要求静态导出时才走 export 模式。
    output: isProd && useStaticExport ? 'export' : undefined,
    distDir: isProd && useStaticExport ? (isDocker ? 'out' : '../backend/static') : undefined,
    basePath: isProd && useStaticExport && !isDocker ? '/static' : undefined,
    assetPrefix: isProd && useStaticExport && !isDocker ? '/static' : undefined,
    // Dev-only: proxy /api-proxy/* to backend to avoid CORS issues (e.g. file downloads)
    async rewrites() {
        return isProd ? [] : [
            {
                source: '/api-proxy/projects/',
                destination: `${BACKEND_URL}/projects/`,
            },
            {
                source: '/api-proxy/projects',
                destination: `${BACKEND_URL}/projects`,
            },
            {
                source: '/api-proxy/:path*',
                destination: `${BACKEND_URL}/:path*`,
            },
        ];
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        unoptimized: true,
        remotePatterns: [
            {
                protocol: "https",
                hostname: "placehold.co",
            },
            {
                protocol: "http",
                hostname: "localhost",
                port: "17177",
            },
        ],
    },
};

export default nextConfig;
