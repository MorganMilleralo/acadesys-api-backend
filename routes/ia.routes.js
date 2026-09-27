const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const tutorHandler = async (req, res) => {
  try {
    const { alumno, estudiante, historialNotas, historialSimulacros, pregunta } = req.body;

    const nombreEstudiante = (alumno && alumno.nombre) || estudiante || "Estudiante";
    const notas = historialNotas || historialSimulacros || [];

    const prompt = `
      Eres un tutor pedagógico preuniversitario experto de AcadeSys.
      Estudiante: ${nombreEstudiante}
      Consulta/Pregunta del estudiante: ${pregunta || "Diagnóstico general de rendimiento"}
      Historial de Evaluaciones: ${JSON.stringify(notas)}

      Responde ÚNICAMENTE en formato JSON con la siguiente estructura exacta:
      {
        "respuesta": "Tu mensaje o respuesta pedagógica directa, amigable y motivadora para el alumno",
        "resumenGeneral": "Evaluación breve y directa de su rendimiento",
        "puntosFuertes": ["Tema o habilidad destacada"],
        "areasMejora": ["Puntos críticos que debe reforzar"],
        "planEstudio": ["Recomendación de estudio inmediata"]
      }
    `;

    // Lista de modelos ordenados por prioridad ante picos de demanda (503)
    const modelosDisponibles = ["gemini-3.8-flash", "gemini-3.1-pro-preview"];
    let responseText = null;
    let ultimoError = null;

    for (const nombreModelo of modelosDisponibles) {
      try {
        const model = genAI.getGenerativeModel({
          model: nombreModelo,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });

        const result = await model.generateContent(prompt);
        responseText = result.response.text();
        if (responseText) break; // Si respondió con éxito, salimos del ciclo
      } catch (err) {
        console.warn(`[Tutor IA] ${nombreModelo} no respondió (${err.message}). Evaluando alternativa...`);
        ultimoError = err;
      }
    }

    if (!responseText) {
      throw ultimoError || new Error("No hubo disponibilidad en los modelos de IA.");
    }

    const dataParsed = JSON.parse(responseText);

    return res.status(200).json({
      ...dataParsed,
      mensaje: dataParsed.respuesta,
      analisis: dataParsed.respuesta,
    });
  } catch (error) {
    console.error("Error en Tutor IA:", error.message);
    return res.status(500).json({
      error: "Error procesando la consulta con IA: " + error.message,
    });
  }
};

// Rutas duales compatibles
router.post("/tutor-ia", tutorHandler);
router.post("/tutor-ia/diagnostico", tutorHandler);

module.exports = router;