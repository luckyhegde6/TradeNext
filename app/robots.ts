import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/admin/', '/api/', '/auth/verify'],
        },
        sitemap: 'https://tradenext6.netlify.app/sitemap.xml',
    }
}
