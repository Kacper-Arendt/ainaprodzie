# Expects the fat jar to be built first: ./mvnw package
# Then: docker build -t retrofit:<version> .
FROM eclipse-temurin:25-jre
RUN useradd --system --uid 1001 --home-dir /app --shell /usr/sbin/nologin retrofit
WORKDIR /app
COPY target/retrofit-*.jar app.jar
USER retrofit
EXPOSE 8080
# Without an explicit cap the JVM takes 25% of container RAM.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
ENTRYPOINT ["java", "-jar", "app.jar"]
