const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post("/tutor-ia/diagnostico", async (req, res) => {
  try {
    const { alumno, historialNotas } = req.body;

    // Validación defensiva
    if (!alumno || !historialNotas) {
      return res.status(400).json({
        error: "Debes enviar los datos del 'alumno' y su 'historialNotas'.",
      });
    }

    const prompt = `
      Eres un tutor académico pedagógico experto en academias preuniversitarias.
      Analiza el siguiente perfil y su historial de calificaciones:
      - Alumno: ${alumno.nombre || "Estudiante"}
      - Aula/Ciclo: ${alumno.aula || "General"}
      - Promedio Actual: ${alumno.promedio ?? "Sin promedio"}
      - Evaluaciones: ${JSON.stringify(historialNotas)}

      Genera un diagnóstico académico y plan de estudio adaptado a su rendimiento.
    `;

    // Configuración con JSON forzado nativo para evitar fallos de parseo
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return res.status(200).json(JSON.parse(responseText));
  } catch (error) {
    console.error("Error en Tutor IA:", error.message);
    return res.status(500).json({
      error: "Error procesando el diagnóstico con IA: " + error.message,
    });
  }
});

module.exports = router;