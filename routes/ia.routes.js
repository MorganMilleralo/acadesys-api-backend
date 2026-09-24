const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post("/tutor-ia/diagnostico", async (req, res) => {
  try {
    const { alumno, historialNotas } = req.body;

    const prompt = `
            Eres un tutor académico experto. Analiza el siguiente perfil y su historial de notas.
            Alumno: ${alumno.nombre}, Aula: ${alumno.aula}, Promedio General: ${alumno.promedio}.
            Notas: ${JSON.stringify(historialNotas)}.
            
            Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
            {
                "resumenGeneral": "tu evaluación",
                "puntosFuertes": ["punto 1", "punto 2"],
                "areasMejora": ["área 1", "área 2"],
                "planEstudio": ["paso 1", "paso 2"]
            }
        `;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    let responseText = result.response.text();

    // Limpiar las etiquetas Markdown (```json) que suele devolver Gemini
    responseText = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    res.json(JSON.parse(responseText));
  } catch (error) {
    res
      .status(500)
      .json({
        error: "Error procesando el diagnóstico con IA: " + error.message,
      });
  }
});

module.exports = router;
