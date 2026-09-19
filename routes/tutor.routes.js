const { Router } = require('express');

const router = Router();

router.post('/tutor-ia', async (req, res) => {
  try {
    const { pregunta } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Falta la API Key de Gemini en el servidor backend.");
    }

    // OJO: "gemini-1.5-flash" ya está retirado. Google lo fue apagando durante 2026.
    // El modelo vigente hoy (según la documentación oficial de Google) es gemini-3.8-flash.
    const responseAI = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Actúa como tutor pedagógico escolar. Responde de forma directa a: ${pregunta}` }] }]
      })
    });

    const data = await responseAI.json();
    const textoRespuesta = data.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar una respuesta.";

    return res.json({ respuesta: textoRespuesta });
  } catch (error) {
    console.error("Error en tutor-ia:", error);
    return res.status(500).json({ error: "Error al procesar la consulta con el Tutor IA" });
  }
});

module.exports = router;