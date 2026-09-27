# Guía para Araceli: conectar Mercado Pago a la reserva de clases de prueba

¡Hola, Ara! 💜 Esta guía es para dejar lista tu cuenta de Mercado Pago y que la gente pueda pagar la clase de prueba desde el link que mandás por WhatsApp. Son unos pasos, se hacen una sola vez y no hace falta saber programar.

**Antes de arrancar**
- Usá **tu** cuenta de Mercado Pago (la del estudio, donde querés recibir la plata).
- Hacelo desde la compu, es más cómodo que desde el celu.
- Los nombres de los botones que ves acá son los que usa Mercado Pago en su sitio para desarrolladores (lo revisamos en septiembre de 2026). Si algo cambió de lugar, avisale a Leandro y lo vemos juntos.

> 🔒 **Lo más importante de toda la guía:** hay una clave que se llama **Access Token**. Es como la llave de tu caja: con ella se puede cobrar a tu nombre. **Nunca la mandes por WhatsApp, mail, Instagram ni ningún chat, y no le saques captura.** Cuando llegue el momento, Leandro te va a proponer una forma segura de cargarla (por ejemplo, la opción *Compartir credenciales* de Mercado Pago, que da acceso sin tener que pasar la clave). 

---

## 1. Entrar a Mercado Pago Developers

1. Entrá a **https://www.mercadopago.com.ar/developers**
2. Arriba a la derecha tocá **Ingresar** y entrá con tu usuario y contraseña de Mercado Pago de siempre.
3. Ya adentro, arriba a la derecha vas a ver **Tus integraciones**. Ahí es donde vamos a trabajar.

Puede que Mercado Pago te pida validar tu identidad la primera vez. Es normal.

## 2. Crear la “aplicación”

La “aplicación” es solo una ficha que le dice a Mercado Pago: “voy a cobrar desde esta página”. No es una app para el celular.

1. En **Tus integraciones**, tocá **Crear aplicación**.
2. Ponele un nombre fácil, por ejemplo: **Éter clase de prueba**.
3. Cuando te pregunte qué tipo de pago vas a integrar, elegí **Pagos online**.
4. Cuando pregunte si usás una plataforma de e-commerce (tipo Tienda Nube o Shopify), respondé que **no**: es una página hecha a medida (“desarrollo propio”). Si te pide la URL de la tienda, podés poner **https://loffines.github.io/eter-clase-prueba/**.
5. En el producto, elegí **Checkouts** y después **Checkout Pro**.
6. Revisá el resumen, aceptá la *Declaración de Privacidad* y los *Términos y condiciones* y tocá **Confirmar** (o **Crear aplicación**, según lo que te muestre).

¡Listo! La aplicación aparece como una tarjeta en **Tus integraciones**.

## 3. Dónde están las credenciales (sin copiarlas a ningún lado)

Entrá a tu aplicación. En el menú de la izquierda vas a ver dos secciones:

- **Pruebas → Credenciales de prueba**: sirven para hacer pagos de mentira y probar que todo funcione. Se crean solas cuando creás la aplicación.
- **Producción → Credenciales de producción**: son las que cobran de verdad. Todavía **no** las vamos a usar.

En cada una vas a ver una **Public Key** y un **Access Token**. Solo mirá que estén; no las copies ni las mandes. 🔒

## 4. Crear cuentas de prueba (para simular una alumna que paga)

Para probar sin plata real, Mercado Pago usa “cuentas de prueba”: una hace de vendedora y otra de compradora. Normalmente se crean solas con la aplicación; si necesitás una nueva:

1. Dentro de tu aplicación, andá a **Cuentas de prueba**.
2. Tocá **+ Crear cuenta de prueba**.
3. País: **Argentina** (tiene que ser el mismo para compradora y vendedora; después no se puede cambiar).
4. Descripción: algo como **Compradora prueba 1**.
5. Tipo de cuenta: **Comprador**.
6. Si te pide un monto, poné un valor inventado (por ejemplo 50.000): es plata ficticia para probar.
7. Aceptá los términos y tocá **Crear cuenta de prueba**.

En la tabla vas a ver el **usuario**, la **contraseña** y un **código de verificación** de esa cuenta. Esos datos sí se pueden compartir con Leandro para las pruebas (no mueven plata real). Las pruebas de pago se hacen en una ventana de incógnito, entrando con la cuenta compradora de prueba.

## 5. Activar producción (más adelante, cuando Leandro te avise)

Cuando todo esté probado, se activan las credenciales de producción:

1. **Tus integraciones** → tu aplicación → **Credenciales de producción** (menú de la izquierda).
2. **Industria**: elegí el rubro del estudio (el que mejor describa clases de pole, acro, flexi y danza; por ejemplo, algo de deportes/fitness o educación).
3. **Sitio web** (obligatorio): **https://loffines.github.io/eter-clase-prueba/**
4. Aceptá la *Declaración de Privacidad* y los *Términos y condiciones*, completá el “No soy un robot” y tocá **Activar credenciales de producción**.

Otra vez: el **Access Token de producción** no se manda por chat. Se carga por el canal seguro que coordine Leandro. 🔒

## 6. Sobre la comisión de Mercado Pago

Mercado Pago cobra una comisión por cada pago, y **el porcentaje depende de cuándo querés tener la plata disponible** (plazo de acreditación): si la querés al instante, la comisión es más alta; si esperás más días, es más baja. También puede variar según el medio de pago que use la persona y los impuestos de tu provincia.

No pongo porcentajes acá porque cambian seguido. Los valores actualizados están en la ayuda oficial **“Costos, plazos de acreditación y cuotas”** (https://www.mercadopago.com.ar/help/19032), y el plazo lo elegís desde tu cuenta de Mercado Pago, en **Tu negocio → Costos**. Tenelo en cuenta: de los $5.000 de la clase, lo que te llega es $5.000 menos esa comisión.

---

## Resumen rápido

| Paso | Dónde | ¿Listo? |
|---|---|---|
| Entrar | mercadopago.com.ar/developers → **Ingresar** → **Tus integraciones** | ☐ |
| Crear aplicación | **Crear aplicación** → Pagos online → desarrollo propio → Checkouts → Checkout Pro | ☐ |
| Ver credenciales de prueba | App → **Pruebas → Credenciales de prueba** (no copiar) | ☐ |
| Cuenta compradora de prueba | App → **Cuentas de prueba** → **+ Crear cuenta de prueba** → Comprador | ☐ |
| Producción (más adelante) | App → **Credenciales de producción** → Industria + Sitio web → Activar | ☐ |
| Access Token | 🔒 **Nunca por chat.** Canal seguro con Leandro | ☐ |

Cualquier duda, escribile a Leandro. ¡Gracias! ✨

<sub>Fuentes: documentación oficial de Mercado Pago Developers (Argentina): “Crear aplicación” (Checkout Pro), “Credenciales”, “Cuentas de prueba” y “Realizar compras de prueba”.</sub>
