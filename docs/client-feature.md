# Buscar Personas

Propuesta, sin implementar. Fecha: 2026-11-13.

## 1. Resumen

1. Una sola caja: el usuario escribe qué persona busca y dónde, y leadta hace el resto.
2. Sirve para cualquier perfil: personal de limpieza, plomeros, vendedores, contadores o devs.
3. Los resultados son personas independientes. Cada una trae al menos un email o un teléfono; si no hay contacto, no se muestra ni se cobra.
4. Fuentes elegidas: Serper.dev, el lector de páginas de leadta (gratis), GitHub (gratis) y, como opción con riesgo, actores oficiales de Apify para Instagram y Facebook. El VPS propio sirve para la cola de lectura y la caché.
5. Cada persona apunta a 4 datos (WhatsApp, correo, redes y dolores) por unos USD 0,005 a 0,02 por persona (estimado).

## 2. La experiencia

**Pantalla:** una caja de texto ("¿A quién buscás?"), un campo de ubicación y el botón Buscar. Antes de buscar, leadta muestra qué entendió y cuánto cuesta, por ejemplo: "Personal de limpieza · Palermo · ~25 personas con contacto · 50 créditos".

| Lo que escribe el usuario | Qué devuelve |
|---|---|
| "busco personal de limpieza en Palermo" | Personas que publicaron un anuncio, un perfil o un post ofreciendo limpieza en la zona, con WhatsApp y link a la publicación. |
| "electricista matriculado zona norte" | Electricistas con anuncio, web o cuenta profesional de Instagram, con teléfono o WhatsApp. |
| "vendedores con experiencia en seguros en Córdoba" | Productores o vendedores de seguros independientes que publican su contacto en su web o en su cuenta profesional. |
| "contador independiente en Rosario" | Contadores con web o perfil público, con email o teléfono. |
| "dev React freelance" | Devs con repos en React y email público en GitHub o en su web. |

## 3. Cómo funciona por dentro

1. **Entender:** una IA convierte el pedido en varias búsquedas web dirigidas, por ejemplo: `"limpieza" "Palermo" whatsapp particular`.
2. **Buscar:** Serper siempre, GitHub para devs y, si el usuario lo activa, Instagram y Facebook vía Apify.
3. **Extraer el contacto:** saca email, teléfono y WhatsApp del resultado o de la página, con el lector de páginas de leadta.
4. **Filtrar:** descarta empresas y resultados sin contacto, y une duplicados.
5. **Mostrar:** usa la tabla de siempre, con nombre, rubro, zona, contacto, redes, dolores, la fuente y cuántos de los 4 datos tiene cada persona.

| Qué busco | De dónde sale | Contacto que trae |
|---|---|---|
| Oficios y servicios | Serper (anuncios, webs y perfiles personales), más Instagram y grupos de Facebook (opcional) | WhatsApp o teléfono publicado |
| Comerciales | Serper (webs personales y perfiles), más Instagram (opcional) | Email o teléfono de la web o de la cuenta profesional |
| Técnicos | GitHub, más Serper (portfolios) | Email público |
| Profesionales | Serper, más el lector de páginas | Email o teléfono de la web |

### Persona completa: WhatsApp, correo, redes y dolores

| Dato | Cómo se completa | Costo aprox. |
|---|---|---|
| **WhatsApp** | Del anuncio o post (número o link `wa.me`), de la web con el lector de páginas, o del teléfono de una cuenta profesional de Instagram. Si solo hay un celular argentino, se arma el link `wa.me`. | USD 0 a 0,002 |
| **Correo** | De la web o el anuncio con el lector de páginas, del email público de GitHub, o del email de una cuenta profesional de Instagram. | USD 0 a 0,003 |
| **Redes** | De los links de la web, que el lector de páginas ya detecta, y del bio link de Instagram, que se lee gratis con el mismo lector. Si faltan, una búsqueda en Serper con nombre, rubro y "instagram". | USD 0 a 0,001 |
| **Dolores** | El análisis actual de leadta, con el mismo modelo económico de IA, sobre reseñas y comentarios de clientes, texto de la web, posts, repos de GitHub y bio. Siempre con link a la evidencia. | Unos USD 0,002 a 0,005 |

**Costo por persona completa (estimado):** unos USD 0,005 a 0,01 con Serper, el lector de páginas y GitHub. Unos USD 0,01 a 0,02 si se suman los actores de Instagram y Facebook.

### Fuentes

| Fuente | Perfiles | ¿Trae email o teléfono? | Costo aprox. | Términos | Esfuerzo |
|---|---|---|---|---|---|
| **[Serper.dev](https://serper.dev)**: buscador Google por API | Todos | Sí, extraído del resultado o de la página | Unos USD 1 cada 1.000 búsquedas (USD 0,001 por búsqueda), con 2.500 gratis para probar. Hasta 10 resultados por búsqueda. | API comercial de resultados públicos | Bajo |
| **Lector de páginas de leadta** (`contact-scrape`) | Todos | Sí: email, teléfono, WhatsApp y redes | USD 0 | Lee solo la página pública encontrada | Ya existe |
| **[GitHub API](https://docs.github.com/en/rest/search)** | Devs | Email, si es público | USD 0 | Permitido sin spam ([política](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)) | Bajo |
| **Actores oficiales de Apify para Meta** (opcional) | Oficios, comerciales y freelancers | Email o teléfono de la cuenta profesional, y WhatsApp en posts de grupos | Ver la tabla siguiente | Con riesgo (ver más abajo) | Bajo, porque leadta ya usa Apify |

### Actores oficiales de Apify para Instagram, Facebook y Threads (opcional, con riesgo)

Leen solo datos públicos. Los precios son los "desde" de cada página, del plan más alto; en el plan gratuito o Starter salen más caros.

| Actor | Para qué sirve | ¿Trae contacto? | Precio aprox. |
|---|---|---|---|
| [apify/instagram-search-scraper](https://apify.com/apify/instagram-search-scraper/pricing) | Encontrar perfiles por oficio y zona | Indirecto | USD 1,50 a 2,70 cada 1.000 |
| [apify/instagram-scraper](https://apify.com/apify/instagram-scraper) | Bio, bio link, seguidores, categoría y posts con comentarios | Email y teléfono de la cuenta profesional, cuando se publican (confirmar en la salida) | Unos USD 2,70 cada 1.000 en el plan gratuito, según terceros (confirmar) |
| [apify/instagram-hashtag-analytics-scraper](https://apify.com/apify/instagram-hashtag-analytics-scraper) | Descubrir hashtags del rubro | No | A confirmar |
| [apify/instagram-followers-following-scraper](https://apify.com/apify/instagram-followers-following-scraper) | Expandir la búsqueda con seguidores | No | A confirmar. Suele requerir sesión iniciada, lo que sube el riesgo. |
| [apify/facebook-groups-scraper](https://apify.com/apify/facebook-groups-scraper) | Posts de grupos públicos del rubro, útiles para encontrar personas y dolores | A veces, en el texto del post | Desde USD 2,60 cada 1.000 posts (USD 5 en el plan gratuito) |
| [apify/facebook-search-scraper](https://apify.com/apify/facebook-search-scraper) | Páginas o perfiles por rubro | El de la página pública | A confirmar |
| [apify/facebook-reels-scraper](https://apify.com/apify/facebook-reels-scraper/pricing) | Poco útil | No | Desde USD 3,16 cada 1.000 |
| [apify/threads-profile-api-scraper](https://apify.com/apify/threads-profile-api-scraper) | Bio y links de Threads | Bio link | A confirmar |

**Riesgo y mitigación:**
- **Riesgo:** los [términos de Meta](https://www.facebook.com/terms.php) y las [condiciones de Instagram](https://help.instagram.com/581066165581870) prohíben la recolección automatizada sin permiso, aunque los datos sean públicos.
- **Mitigación:**
  1. Solo datos públicos, sin iniciar sesión.
  2. Solo cuentas profesionales que publican su contacto.
  3. Guardar el link y el contacto, sin copiar contenido masivo.
  4. Retención corta y opción de baja en cada mensaje.
  5. Fuente opcional, que el usuario activa.
  6. Revisión legal antes de lanzar.

### Usar el VPS propio para bajar costos

| Qué se corre en el VPS | Ahorro | Riesgo y mantenimiento |
|---|---|---|
| **Cola de lectura de páginas** (el lector en segundo plano) | USD 0, y búsquedas más rápidas | Bajo. Respetar `robots.txt` y limitar las páginas por sitio. |
| **Caché de resultados** (búsquedas y páginas, de 7 a 30 días) | Menos búsquedas repetidas en Serper. Estimado: 30% a 60% menos en rubros populares, sin medir. | Bajo. Borrar lo vencido y lo dado de baja. |
| **[SearXNG](https://docs.searxng.org/)**, solo como respaldo gratis si Serper falla o se agota el saldo | USD 0 por búsqueda | Google y Bing bloquean IPs y piden captcha con volumen. Mantenimiento frecuente. Opcional. |
| **Verificación de email básica** (consulta SMTP sin enviar correo) | USD 0 | Alto si se abusa: bloqueos de IP y puerto 25 cerrado en muchos VPS. Usar pocas consultas por minuto. |

**Descartadas, y por qué:**
- Google Search Scraper de Apify y Brave Search API: se eligió Serper.
- Bio links vía Apify, Icypeas, Hunter y el formulario "publicá tu perfil": por ROI. El bio link se sigue leyendo gratis con el lector de páginas.
- Google Maps: devuelve negocios, no personas.
- People Data Labs: demasiado caro.
- Mercado Libre: no expone ni email ni teléfono.
- Apollo: no se va a usar.
- LinkedIn, Workana y Upwork: sus términos prohíben la recolección automática.
- Common Crawl: procesarlo es caro.
- Padrones de matriculados: no publican contacto.

## 4. Cobertura con las fuentes elegidas

**Todos los porcentajes son estimaciones sin medir.** Indican qué parte de las personas encontradas tendría cada dato.

| Segmento | WhatsApp | Correo | Redes | Dolores | Dónde queda débil |
|---|---|---|---|---|---|
| **Devs** | Bajo (~10% a 20%) | Alto (~50% a 70%) | Alto (~60% a 80%: GitHub, web, LinkedIn) | Medio (~40% a 60%: repos, portfolio) | WhatsApp: los devs rara vez lo publican. Dolores: pocas reseñas de clientes. |
| **Oficios** (limpieza, plomería) | Alto con Meta (~60% a 80%); medio sin Meta (~30% a 50%) | Bajo (~10% a 25%) | Medio (~40% a 60%) | Medio con Meta (~40% a 60%: comentarios y reseñas); bajo sin Meta | Correo: casi nadie lo publica. Sin los actores de Meta, la cobertura cae mucho, porque estos perfiles viven en Instagram, Facebook y WhatsApp. |
| **Comerciales** (vendedores) | Medio (~30% a 50%) | Medio (~30% a 50%) | Medio (~40% a 60%) | Bajo (~20% a 40%) | Es el segmento más débil. Muchos vendedores trabajan en relación de dependencia y no publican contacto propio. Los que sí lo hacen (productores de seguros, inmobiliarios, revendedores) están en Instagram o en una web personal. |

**Conclusión honesta:**
- Para devs alcanza.
- Para oficios alcanza solo si se activan los actores de Meta; sin ellos, WhatsApp y dolores quedan débiles.
- Para comerciales queda débil.

**Alternativas baratas para los huecos:**
- **Oficios sin Meta:** búsquedas en Serper con operadores sobre clasificados y sitios de anuncios con teléfono visible, más la extracción del snippet. Costo: unos USD 0,001 por búsqueda.
- **Comerciales:** búsquedas en Serper dirigidas a nichos que sí publican contacto, como "productor asesor de seguros" + matrícula, "agente inmobiliario independiente" o "revendedor" + WhatsApp. Si se acepta el riesgo, sumar instagram-search-scraper por rubro.
- **WhatsApp de devs:** no hay una alternativa barata y limpia. Se acepta el correo como canal principal.

### Prueba propuesta antes de construir

1. Hacer 10 búsquedas en Serper por segmento (devs, oficios y comerciales), con 3 ciudades distintas: 30 búsquedas en total, unos USD 0,03, dentro de las 2.500 gratis.
2. Pasar cada resultado por el lector de páginas y contar qué porcentaje trae WhatsApp, correo, redes y texto suficiente para dolores.
3. Repetir 10 búsquedas de oficios con instagram-search-scraper e instagram-scraper (unos USD 0,10) para medir cuánto suma Meta.
4. Con los porcentajes reales, decidir si se activa Meta por defecto y qué segmentos se lanzan primero.

## 5. Lo que NO se hace

- No se copian datos de LinkedIn ni de marketplaces que lo prohíben.
- No se buscan datos sensibles como la edad, la salud o la vida privada ([Ley 25.326, art. 7](https://www.argentina.gob.ar/normativa/nacional/64790/texto), [GDPR, art. 9](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). Si alguien lo pide, leadta sugiere otra búsqueda, por ejemplo "cuidadores independientes".
- Solo se usa el contacto que la persona publicó para ofrecer su trabajo. Cada mensaje incluye la opción de darse de baja.

## 6. MVP por fases

| Fase | Qué incluye | Esfuerzo | Costo |
|---|---|---|---|
| 0 | Prueba de cobertura: 30 búsquedas en Serper y 10 con Meta | 1 día | Unos USD 0,13 |
| 1 | Caja única, IA que arma las búsquedas, Serper y lector de páginas. Filtro "solo con contacto" y lista de bajas. | 4 a 5 días | Unos USD 0,01 a 0,05 por búsqueda de ~25 personas |
| 2 | Persona completa (redes y dolores con el análisis actual) y GitHub para devs | 3 a 4 días | Unos USD 0,005 a 0,01 por persona completa |
| 2b (opcional) | Instagram y grupos de Facebook vía actores oficiales de Apify | 3 días | Unos USD 0,01 a 0,02 por persona completa |
| VPS | Cola de lectura y caché; SearXNG solo como respaldo opcional | 2 a 3 días, más mantenimiento | Baja el gasto en Serper por la caché |

Todos los costos son estimaciones. Hay que confirmar los precios en cada proveedor.

## 7. Preguntas abiertas

1. ¿Cuánto vale para el usuario un contacto? Sirve para fijar los créditos por persona.
2. ¿Alcanza con WhatsApp o teléfono para oficios, o se exige correo también?
3. ¿Se activa Meta por defecto en oficios, o queda como opción del usuario?
4. ¿Qué países además de Argentina?
