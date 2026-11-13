package app.retrofit.platform;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;

/// The rewrite on hand-built schemas, for the shapes no response uses yet; [app.retrofit.OpenApiExportTests] checks
/// it on the real contract.
class NullableReferencesCustomizerTests {

	private static final String REF = "#/components/schemas/NamedRef";

	@Test
	void keepsThePropertysOtherKeywords() {
		var property = nullableRef().description("Who works on it");

		customise(new ObjectSchema().addProperty("assignee", property));

		assertThat(property.getDescription()).isEqualTo("Who works on it");
		assertThat(property.get$ref()).isNull();
		assertThat(property.getTypes()).isNull();
		assertThat(anyOf(property)).extracting(Schema::get$ref).containsExactly(REF, null);
		assertThat(anyOf(property).getLast().getTypes()).containsExactly("null");
	}

	@Test
	void rewritesArrayItemsMapValuesAndInlineObjects() {
		var item = nullableRef();
		var value = nullableRef();
		var inline = nullableRef();
		var schema = new ObjectSchema().addProperty("watchers", new ArraySchema().items(item))
				.addProperty("byTeam", new ObjectSchema().additionalProperties(value))
				.addProperty("handover", new ObjectSchema().addProperty("to", inline));

		customise(schema);

		assertThat(List.of(item, value, inline)).allSatisfy(rewritten -> {
			assertThat(rewritten.get$ref()).isNull();
			assertThat(anyOf(rewritten)).extracting(Schema::get$ref).containsExactly(REF, null);
		});
	}

	@Test
	void leavesANonNullableReferenceAlone() {
		var property = new Schema<>().$ref(REF);

		customise(new ObjectSchema().addProperty("organization", property));

		assertThat(property.get$ref()).isEqualTo(REF);
		assertThat(property.getAnyOf()).isNull();
	}

	private static Schema<Object> nullableRef() {
		return new Schema<>().$ref(REF).types(Set.of("null"));
	}

	@SuppressWarnings("unchecked")
	private static List<Schema<?>> anyOf(Schema<?> schema) {
		return (List<Schema<?>>) (List<?>) schema.getAnyOf();
	}

	private static void customise(Schema<?> component) {
		new NullableReferencesCustomizer()
				.customise(new OpenAPI().components(new Components().schemas(Map.of("Component", component))));
	}

}
