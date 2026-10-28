`timescale 1ns / 1ps

// SystemVerilog 特性展示（均为 Icarus Verilog 11 与 Yosys 支持的子集）：
//   package / typedef enum / typedef struct packed / 函数 / always_ff / always_comb / logic
// 包中的类型在模块里用 包名::类型名 引用。

package demo_pkg;
  // 枚举：操作码
  typedef enum logic [1:0] {
    OP_NOP = 2'd0,
    OP_ADD = 2'd1,
    OP_MUL = 2'd2,
    OP_MAX = 2'd3
  } op_t;

  // 打包结构体：一条命令 = 操作码 + 两个 8 位操作数（共 18 位，可当作普通向量使用）
  typedef struct packed {
    op_t        op;
    logic [7:0] a;
    logic [7:0] b;
  } cmd_t;

endpackage

// 一个简单的流水级：组合计算 + 寄存输出 + 统计已执行的命令数
module sv_showcase (
  input  logic            clk,
  input  logic            rst_n,      // 异步复位，低有效
  input  demo_pkg::cmd_t  cmd,
  input  logic            cmd_valid,
  output logic [15:0]     result,
  output logic            result_valid,
  output logic            wide,       // 结果超过 8 位
  output logic [7:0]      count
);

  logic [15:0] next_result;
  logic        next_wide;

  // 纯组合函数：执行一条命令（可综合写法：给函数名赋值作为返回值）
  function automatic logic [15:0] execute(input demo_pkg::cmd_t c);
    case (c.op)
      demo_pkg::OP_ADD: execute = {8'd0, c.a} + {8'd0, c.b};
      demo_pkg::OP_MUL: execute = c.a * c.b;
      demo_pkg::OP_MAX: execute = (c.a > c.b) ? {8'd0, c.a} : {8'd0, c.b};
      default:          execute = 16'd0;
    endcase
  endfunction

  // 连续赋值中调用函数
  assign next_result = execute(cmd);

  // always_comb：自动推断敏感列表，且不允许产生锁存器
  always_comb begin
    next_wide = 1'b0;
    if (next_result > 16'd255) next_wide = 1'b1;
  end

  // always_ff：只描述时序逻辑
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      result       <= '0;
      wide         <= 1'b0;
      result_valid <= 1'b0;
      count        <= '0;
    end else begin
      result_valid <= cmd_valid;
      if (cmd_valid) begin
        result <= next_result;
        wide   <= next_wide;
        count  <= count + 8'd1;
      end
    end
  end

endmodule
