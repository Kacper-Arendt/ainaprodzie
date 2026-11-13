package app.retrofit.platform;

import java.util.List;
import java.util.Set;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.stereotype.Component;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Schema;

/// springdoc renders a nullable reference as a `$ref` with a `null` type beside it, which JSON Schema ignores, so the
/// generated TypeScript would claim the field is never null. Each such schema becomes
/// `anyOf: [{$ref}, {type: null}]` (standards/backend/api.md), wherever it sits under a component: a property, an
/// array's items, a map's values, or inside an inline object. It is rewritten in place, so its description, example
/// and other keywords stay.
@Component
class NullableReferencesCustomizer implements OpenApiCustomizer {

	@Override
	public void customise(OpenAPI openApi) {
		if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
			return;
		}
		openApi.getComponents().getSchemas().values().forEach(NullableReferencesCustomizer::rewriteNested);
	}

	private static void rewriteNested(Schema<?> schema) {
		if (schema.getProperties() != null) {
			schema.getProperties().values().forEach(NullableReferencesCustomizer::rewrite);
		}
		if (schema.getItems() != null) {
			rewrite(schema.getItems());
		}
		if (schema.getAdditionalProperties() instanceof Schema<?> values) {
			rewrite(values);
		}
	}

	private static void rewrite(Schema<?> schema) {
		if (!isNullableReference(schema)) {
			rewriteNested(schema);
			return;
		}
		var ref = schema.get$ref();
		schema.set$ref(null);
		schema.setNullable(null);
		schema.setType(null);
		schema.setTypes(null);
		schema.setAnyOf(List.of(new Schema<>().$ref(ref), new Schema<>().types(Set.of("null"))));
	}

	private static boolean isNullableReference(Schema<?> schema) {
		var typedNull = "null".equals(schema.getType())
				|| schema.getTypes() != null && schema.getTypes().contains("null");
		return schema.get$ref() != null && (Boolean.TRUE.equals(schema.getNullable()) || typedNull);
	}

}
