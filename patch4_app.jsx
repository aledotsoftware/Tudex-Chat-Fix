<<<<<<< SEARCH
              <div className="composerActions">
                {!correctedDraft ? (
                  <>
                    <button
                      className="primary"
                      aria-label="Mejorar redacción con IA y enviar"
                      onClick={correctAndSend}
                      disabled={!draft.trim() || sending || correcting || correctingAndSending || isOffline}
                    ><span aria-hidden="true">🚀</span> <span>Mejorar y enviar</span>
                    </button>
                    <button
                      className="secondary"
                      aria-label="Previsualizar corrección de IA sin enviar"
                      onClick={correctDraft}
                      disabled={!draft.trim() || sending || correcting || correctingAndSending || isOffline}
                    ><span aria-hidden="true">✨</span> <span>Ver sugerencia</span>
                    </button>
                    <button
                      className="secondary plainSendBtn"
                      aria-label="Enviar mensaje original sin revisar"
                      onClick={() => sendMessage(draft, "original")}
                      disabled={!draft.trim() || sending || correcting || correctingAndSending || isOffline}
                    ><span aria-hidden="true">📤</span> <span>Enviar original</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="primary sendCorrectedBtn"
                      aria-label="Enviar la sugerencia de IA"
                      onClick={() => sendMessage(correctedDraft, "corrected")}
                      disabled={sending || correcting || correctingAndSending || isOffline}
                    >
                      <span aria-hidden="true">✨</span> <span>Enviar versión IA</span>
                    </button>
                    <button
                      className="secondary useCorrectedBtn"
                      onClick={() => {
                        setDraft(correctedDraft);
                        setCorrectedDraft("");
                        setTimeout(() => draftInputRef.current?.focus(), 0);
                      }}
                      aria-label="Usar sugerencia en el cuadro principal para editar"
                      disabled={sending || correcting || correctingAndSending}
                    ><span aria-hidden="true">✏️</span> <span>Usar y editar</span>
                    </button>
                    <button
                      className="secondary plainSendBtn"
                      aria-label="Enviar el texto original, descartando la sugerencia"
                      onClick={() => sendMessage(draft, "original")}
                      disabled={!draft.trim() || sending || correcting || correctingAndSending || isOffline}
                    ><span aria-hidden="true">📤</span> <span>Enviar original (sin IA)</span>
                    </button>
                  </>
                )}
              </div>
=======
              <div className="composerActions">
                <button
                  className={correctedDraft ? "primary sendCorrectedBtn" : "primary"}
                  aria-label={correctedDraft ? "Enviar la sugerencia de IA" : "Mejorar redacción con IA y enviar"}
                  onClick={correctedDraft ? () => sendMessage(correctedDraft, "corrected") : correctAndSend}
                  disabled={!draft.trim() || sending || correctingAndSending || isOffline}
                >
                  <span aria-hidden="true">{correctedDraft ? "✨" : "🚀"}</span>
                  <span>{correctedDraft ? "Enviar versión IA" : "Mejorar y enviar"}</span>
                </button>
                <button
                  className={correctedDraft ? "secondary useCorrectedBtn" : "secondary"}
                  aria-label={correctedDraft ? "Usar sugerencia en el cuadro principal para editar" : "Previsualizar corrección de IA sin enviar"}
                  onClick={correctedDraft ? () => {
                    setDraft(correctedDraft);
                    setCorrectedDraft("");
                    setTimeout(() => draftInputRef.current?.focus(), 0);
                  } : correctDraft}
                  disabled={!draft.trim() || sending || correctingAndSending || (!correctedDraft && isOffline)}
                >
                  <span aria-hidden="true">{correctedDraft ? "✏️" : "✨"}</span>
                  <span>{correctedDraft ? "Usar y editar" : "Ver sugerencia"}</span>
                </button>
                <button
                  className="secondary plainSendBtn"
                  aria-label={correctedDraft ? "Enviar el texto original, descartando la sugerencia" : "Enviar mensaje original sin revisar"}
                  onClick={() => sendMessage(draft, "original")}
                  disabled={!draft.trim() || sending || correctingAndSending || isOffline}
                >
                  <span aria-hidden="true">📤</span>
                  <span>{correctedDraft ? "Enviar original (sin IA)" : "Enviar original"}</span>
                </button>
              </div>
>>>>>>> REPLACE
